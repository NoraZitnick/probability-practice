'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MarbleModel = require('../js/model.js');
const { KINDS, MISTAKES, SCENARIOS, scenarioConfig } = require('../js/scenarios.js');

/** A repeatable random source, so these statistical tests can't fail by chance. */
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Evaluates one side of a written equation, such as '13/52 + 4/52 – 1/52' or '49%', as a probability. */
function evaluate(expression) {
  const arithmetic = expression.trim()
    .replace(/×/g, '*')
    .replace(/–/g, '-')
    .replace(/(\d+(\.\d+)?)%/g, '($1/100)');
  assert.match(arithmetic, /^[\d\s.+\-*/()]+$/, `can't read "${expression}"`);
  return Function(`return ${arithmetic};`)();
}

/** The numbers on the left of the equation, in order: '5/10 × 4/9' gives [0.5, 0.444…]. */
function terms(equation) {
  const left = equation.split(/=|≈/)[0];
  return left.split(/[×+–]/).map(evaluate);
}

const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} is not within ${tolerance} of ${expected}`);
};

test('every kind of event has the same number of questions', () => {
  const counts = Object.keys(KINDS).map((kind) => SCENARIOS.filter((s) => s.kind === kind).length);
  assert.ok(counts[0] > 0);
  counts.forEach((count) => assert.equal(count, counts[0]));
  SCENARIOS.forEach((s) => assert.ok(s.kind in KINDS, s.text));
});

test('every wrong answer has its own explanation', () => {
  Object.keys(KINDS).forEach((correct) => {
    const chosen = Object.keys(KINDS).filter((kind) => kind !== correct);
    assert.deepEqual(Object.keys(MISTAKES[correct]).sort(), chosen.sort());
    chosen.forEach((kind) => assert.ok(MISTAKES[correct][kind].length > 0));
  });
});

SCENARIOS.forEach((scenario) => {
  const config = scenarioConfig(scenario);
  const answer = MarbleModel.expectedPercent(config) / 100;

  test(`math adds up: ${scenario.text}`, () => {
    // Each step of the written equation has the same value, allowing for rounding to 0.1%.
    scenario.equation.split(/=|≈/).forEach((step) => {
      near(evaluate(step), answer, 0.0005, `"${step.trim()}" in ${scenario.equation}`);
    });
  });

  test(`the machine matches the question: ${scenario.text}`, () => {
    const { pA, pB, overlap, kind } = scenario;
    const numbers = terms(scenario.equation);
    const expectedTerms = {
      stack: [pA, pB],
      dependent: [pA, (100 * overlap) / pA],
      side: [pA, pB],
      overlap: [pA, pB, overlap],
    }[kind].map((percent) => percent / 100);
    assert.equal(numbers.length, expectedTerms.length, scenario.equation);
    numbers.forEach((value, index) => near(value, expectedTerms[index], 1e-9, `term ${index + 1} of ${scenario.equation}`));

    // The doors are drawn at the right widths, inside the wall, sharing only the overlap.
    const { a, b } = MarbleModel.doorsFor(config);
    assert.ok(MarbleModel.fits(config));
    near(a.end - a.start, pA, 1e-9, 'Gate A width');
    near(b.end - b.start, pB, 1e-9, 'Gate B width');
    [a, b].forEach((door) => assert.ok(door.start >= -1e-9 && door.end <= 100 + 1e-9, 'door inside the wall'));
    const shared = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
    if (kind === 'side') near(shared, 0, 1e-9, 'mutually exclusive doors share nothing');
    if (kind === 'dependent' || kind === 'overlap') near(shared, overlap, 1e-9, 'shared width is P(A and B)');
    if (kind === 'stack') assert.equal(config.shuffler, true);
    if (kind === 'dependent') assert.equal(config.shuffler, false);
  });

  test(`each kind's answer uses the question's numbers and the four differ: ${scenario.text}`, () => {
    const { pA, pB, overlap, kind } = scenario;
    assert.deepEqual(Object.keys(scenario.answers).sort(), Object.keys(KINDS).sort());
    const values = {};
    Object.entries(scenario.answers).forEach(([answerKind, written]) => {
      const steps = written.split(/=|≈/).map(evaluate);
      steps.forEach((value) => near(value, steps[0], 0.0005, written));
      values[answerKind] = steps[0];
    });

    // Each wrong answer is what a student would get by treating the question as that kind.
    // With no overlap given, the overlap a student would subtract is P(A) × P(B).
    const both = (overlap === undefined ? (pA * pB) / 100 : overlap) / 100;
    near(values.stack, (pA * pB) / 10000, 1e-9, 'independent answer');
    near(values.side, (pA + pB) / 100, 1e-9, 'mutually exclusive answer');
    near(values.overlap, (pA + pB) / 100 - both, 1e-9, 'not mutually exclusive answer');
    if (kind === 'side') near(values.dependent, 0, 1e-9, 'dependent answer');
    if (kind === 'dependent' || kind === 'overlap') near(values.dependent, both, 1e-9, 'dependent answer');

    const sorted = Object.values(values).sort((p, q) => p - q);
    sorted.slice(1).forEach((value, index) => {
      assert.ok(value - sorted[index] > 0.001, `two answers are equal in ${JSON.stringify(scenario.answers)}`);
    });
    assert.equal(scenario.equation, scenario.answers[kind]);
  });

  test(`dropped marbles match the answer: ${scenario.text}`, () => {
    [1, 2, 3].forEach((seed) => {
      const stats = MarbleModel.simulate(config, 100000, seeded(seed));
      near(stats.landed / 100000, answer, 0.006, `run ${seed}`);
    });
  });
});
