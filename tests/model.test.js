'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MarbleModel = require('../js/model.js');

const stack = { pA: 50, pB: 30, layout: 'stack' };
const side = { pA: 50, pB: 30, layout: 'side' };

const isInside = (door, position) => position >= door.start && position < door.end;

/** A repeatable random source, so these statistical tests can't fail by chance. */
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const MANY = 100000;

const assertNear = (actual, expected) => {
  assert.ok(Math.abs(actual - expected) < 0.01, `${actual} is not near ${expected}`);
};

test('stacked gates average out to the product', () => {
  const stats = MarbleModel.simulate(stack, MANY, seeded(1));
  assertNear(stats.landed / MANY, 0.15);
  assertNear(stats.stoppedA / MANY, 0.5);
});

test('side-by-side gates average out to the sum', () => {
  const stats = MarbleModel.simulate(side, MANY, seeded(2));
  assertNear(stats.landed / MANY, 0.8);
  assertNear(stats.landedA / MANY, 0.5);
  assertNear(stats.landedB / MANY, 0.3);
});

test('passing Gate A has no effect on the chance at Gate B', () => {
  const stats = MarbleModel.simulate(stack, MANY, seeded(3));
  assertNear(stats.landed / (stats.landed + stats.stoppedB), 0.3);
});

test('counts vary from run to run', () => {
  const random = seeded(4);
  const counts = new Set();
  for (let run = 0; run < 50; run += 1) {
    counts.add(MarbleModel.simulate(stack, 100, random).landed);
  }
  assert.ok(counts.size > 1);
});

test('doors that fill the wall let every marble through', () => {
  assert.equal(MarbleModel.simulate({ ...stack, pA: 100, pB: 100 }, 100).landed, 100);
  assert.equal(MarbleModel.simulate({ ...side, pA: 60, pB: 40 }, 100).landed, 100);
});

test('overlapping doors pass some marbles through both', () => {
  const overlapping = { ...side, overlap: 10 };
  assert.equal(MarbleModel.expectedPercent(overlapping), 70);
  const stats = MarbleModel.simulate(overlapping, MANY, seeded(5));
  assertNear(stats.landed / MANY, 0.7);
  assertNear((stats.landed - stats.landedA - stats.landedB) / MANY, 0.1);
});

test('without the shuffler, passing Gate A changes the chance at Gate B', () => {
  const dependent = { ...stack, shuffler: false };
  assert.equal(MarbleModel.expectedPercent(dependent), 30);
  const stats = MarbleModel.simulate(dependent, MANY, seeded(6));
  assertNear(stats.landed / (stats.landed + stats.stoppedB), 0.6);
});

test('lined-up gates without the shuffler share exactly the overlap', () => {
  const lined = { ...stack, shuffler: false, pA: 50, pB: 50, overlap: 20 };
  assert.equal(MarbleModel.fits(lined), true);
  assert.equal(MarbleModel.expectedPercent(lined), 20);
  const stats = MarbleModel.simulate(lined, MANY, seeded(7));
  assertNear(stats.landed / MANY, 0.2);
});

test('without the shuffler, Gate B shifts over from a centered Gate A', () => {
  const shifted = { ...stack, shuffler: false, pA: 50, pB: 50, overlap: 40 };
  assert.deepEqual(MarbleModel.doorsFor(shifted), { a: { start: 25, end: 75 }, b: { start: 35, end: 85 } });
  assert.equal(MarbleModel.expectedPercent(shifted), 40);
});

test('a marble never passes through both side-by-side doors', () => {
  MarbleModel.planRun(side, 100).forEach(({ outcome }) => {
    assert.notEqual(outcome, 'both');
  });
});

test('side-by-side doors leave no gap between them', () => {
  const { a, b } = MarbleModel.doorsFor(side);
  assert.equal(a.end, b.start);
});

test('side-by-side doors must fit in the wall', () => {
  assert.equal(MarbleModel.fits({ ...side, pA: 60, pB: 60 }), false);
  assert.equal(MarbleModel.fits({ ...side, pA: 60, pB: 40 }), true);
  assert.equal(MarbleModel.fits({ ...side, pA: 100 / 6, pB: 500 / 6 }), true);
  assert.equal(MarbleModel.fits({ ...stack, pA: 60, pB: 60 }), true);
});

test('every marble takes a route that matches its outcome', () => {
  const configs = [
    stack,
    side,
    { ...stack, pA: 100, pB: 100 },
    { ...side, pA: 60, pB: 40 },
    { ...stack, shuffler: false },
    { ...stack, shuffler: false, pA: 50, pB: 50, overlap: 20 },
  ];

  configs.forEach((config) => {
    const { a, b } = MarbleModel.doorsFor(config);
    MarbleModel.planRun(config, 100).forEach(({ entry, exit, outcome }) => {
      assert.ok(entry >= 0 && entry <= 100 && exit >= 0 && exit <= 100);
      if (config.layout === 'side') {
        assert.equal(isInside(a, entry), outcome === 'a');
        assert.equal(isInside(b, entry), outcome === 'b');
      } else {
        assert.equal(isInside(a, entry), outcome !== 'stoppedA');
        if (outcome !== 'stoppedA') assert.equal(isInside(b, exit), outcome === 'both');
      }
    });
  });
});

test('an undamaged machine is not scrambled', () => {
  const routes = MarbleModel.planRun(stack, 100);
  assert.equal(MarbleModel.scrambleRoutes(routes, 'stack', 0), routes);
});

test('partial damage only uses outcomes that exist for the layout', () => {
  const routes = MarbleModel.scrambleRoutes(MarbleModel.planRun(side, 100), 'side', 0.5);
  routes.forEach(({ outcome }) => {
    assert.ok(['a', 'b', 'missed'].includes(outcome));
  });
});

test('a fully broken machine loses every marble', () => {
  const routes = MarbleModel.scrambleRoutes(MarbleModel.planRun(stack, 100), 'stack', 1);
  routes.forEach(({ outcome }) => assert.equal(outcome, 'lost'));

  const stats = MarbleModel.emptyStats(100);
  routes.forEach(({ outcome }) => MarbleModel.recordStop(stats, outcome));
  assert.equal(stats.missed, 100);
  assert.equal(stats.landed, 0);
});

test('every dropped marble is accounted for', () => {
  [stack, side].forEach((config) => {
    const stats = MarbleModel.simulate(config, 100);
    assert.equal(stats.dropped, 100);
    assert.equal(stats.landed + stats.stoppedA + stats.stoppedB + stats.missed, 100);
  });
});
