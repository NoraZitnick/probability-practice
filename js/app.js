'use strict';

/* Runs the sequence of screens and connects each one to its machine. */

const STARTING_ESTIMATE = 50;
const QUESTIONS_PER_KIND = 2;

/** The gates on each of the first four screens. Gate B moves and resizes between them. */
const EXPERIMENT_STEPS = {
  stack: { ...KINDS.stack, pA: 50, pB: 50 },
  dependent: { ...KINDS.dependent, pA: 50, pB: 50, overlap: 40 },
  side: { ...KINDS.side, pA: 50, pB: 30 },
  overlap: { ...KINDS.overlap, pA: 50, pB: 30 },
};

const KIND_NAMES = {
  stack: 'Independent',
  dependent: 'Dependent',
  side: 'Mutually exclusive',
  overlap: 'Not mutually exclusive',
};

function announce(message) {
  document.getElementById('announcer').textContent = message;
}

/** Fills each [data-slot="key"] inside root with values[key]. */
function fillSlots(root, values) {
  root.querySelectorAll('[data-slot]').forEach((element) => {
    if (!(element.dataset.slot in values)) return;
    const value = String(values[element.dataset.slot]);
    // A broken machine can no longer report real numbers.
    element.textContent = Explosions.isBroken() ? value.replace(/\d+(\.\d+)?/g, 'NaN') : value;
  });
}

function asDecimal(percent) {
  return String(parseFloat((percent / 100).toFixed(4)));
}

function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Keeps the machine in view on small screens, where it can scroll out of the screen. */
function bringIntoView(element) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
}

/* ---------- Independent and mutually exclusive screens ---------- */

/** These screens share one machine, so moving between them animates the gates into place. */
function setupExperiment() {
  const section = document.getElementById('experiment');
  const canvas = section.querySelector('canvas');
  const machine = new Machine(canvas, {
    ...EXPERIMENT_STEPS.stack,
  });

  function setupStep(name) {
    const panel = section.querySelector(`[data-step="${name}"]`);
    const slider = panel.querySelector('input[type="range"]');
    const output = panel.querySelector('output');
    const dropButton = panel.querySelector('[data-drop]');
    const result = panel.querySelector('[data-result]');
    const hint = panel.querySelector('[data-hint]');
    let hasEstimated = false;

    const syncEstimate = () => {
      output.textContent = slider.value;
      machine.setGuess(Number(slider.value));
    };

    const setBusy = (busy) => {
      slider.disabled = busy;
      dropButton.disabled = busy || !hasEstimated;
      hint.hidden = hasEstimated;
    };

    slider.addEventListener('input', () => {
      hasEstimated = true;
      syncEstimate();
      setBusy(false);
    });

    dropButton.addEventListener('click', () => {
      result.hidden = true;
      setBusy(true);
      bringIntoView(canvas);
      machine.run(100, {
        onDone: (stats) => {
          const estimate = Number(slider.value);
          // Runs vary, so a prediction is judged against the math, not this run's count.
          const isCorrect = estimate === Math.round(MarbleModel.expectedPercent(machine.config));
          fillSlots(panel, {
            estimate,
            verdict: isCorrect ? 'Correct.' : 'Not quite.',
            landed: stats.landed,
            passedA: stats.landed + stats.stoppedB,
          });
          const verdict = panel.querySelector('[data-slot="verdict"]');
          verdict.classList.toggle('verdict--correct', isCorrect);
          verdict.classList.toggle('verdict--wrong', !isCorrect);
          result.hidden = false;
          setBusy(false);
          dropButton.textContent = 'Drop 100 Again';
          dropButton.classList.add('button--secondary');
          announce(result.querySelector('p').textContent);
        },
      });
    });

    const clear = () => {
      result.hidden = true;
      hasEstimated = false;
      slider.value = STARTING_ESTIMATE;
      setBusy(false);
      dropButton.textContent = 'Drop 100 Marbles';
      dropButton.classList.remove('button--secondary');
    };

    setBusy(false);

    return { panel, syncEstimate, setBusy, clear };
  }

  const steps = {};
  Object.keys(EXPERIMENT_STEPS).forEach((name) => { steps[name] = setupStep(name); });
  let shownStep = 'stack';

  function show(name) {
    const step = steps[name];
    Object.entries(steps).forEach(([key, other]) => { other.panel.hidden = key !== name; });

    if (shownStep !== name) {
      shownStep = name;
      step.clear();
      step.setBusy(true);
      machine.morphTo(EXPERIMENT_STEPS[name], () => step.setBusy(false));
    }
    step.syncEstimate();
  }

  function leave() {
    if (!machine.running) return;
    machine.reset();
    Object.values(steps).forEach((step) => step.clear());
  }

  return { section, show, leave };
}

/* ---------- Compare screen ---------- */

function setupLab() {
  const section = document.getElementById('lab');
  const sliderA = section.querySelector('#lab-a');
  const sliderB = section.querySelector('#lab-b');
  const sliderOverlap = section.querySelector('#lab-overlap');
  const dropButton = section.querySelector('[data-drop-all]');

  const readConfig = (kind) => ({
    ...KINDS[kind],
    pA: Number(sliderA.value),
    pB: Number(sliderB.value),
    ...(kind === 'overlap' ? { overlap: Number(sliderOverlap.value) } : {}),
  });

  const machines = [...section.querySelectorAll('[data-machine]')].map((panel) => {
    const kind = panel.dataset.machine;
    return { kind, panel, machine: new Machine(panel.querySelector('canvas'), readConfig(kind)) };
  });

  function equationFor(kind) {
    const config = readConfig(kind);
    const [a, b] = [asDecimal(config.pA), asDecimal(config.pB)];
    const total = asDecimal(MarbleModel.expectedPercent(config));
    if (kind === 'stack') return `${a} × ${b} = ${total}`;
    if (kind === 'dependent') {
      const bGivenA = asDecimal((100 * MarbleModel.expectedPercent(config)) / config.pA);
      return `${a} × ${bGivenA} = ${total}`;
    }
    if (kind === 'side') return `${a} + ${b} = ${asDecimal(config.pA + config.pB)}`;
    return `${a} + ${b} – ${asDecimal(config.overlap)} = ${total}`;
  }

  /** The overlap can't be wider than either door, and wide doors must overlap to fit. */
  function clampOverlap() {
    const pA = Number(sliderA.value);
    const pB = Number(sliderB.value);
    sliderOverlap.min = Math.max(0, pA + pB - 100);
    sliderOverlap.max = Math.min(pA, pB);
    sliderOverlap.value = Math.min(sliderOverlap.max, Math.max(sliderOverlap.min, Number(sliderOverlap.value)));
  }

  function setResult(panel, stats) {
    fillSlots(panel, { landed: stats ? `${stats.landed} of ${stats.total}` : '–' });
  }

  function refreshReadouts() {
    clampOverlap();
    section.querySelector('#lab-a-value').textContent = `${sliderA.value}%`;
    section.querySelector('#lab-b-value').textContent = `${sliderB.value}%`;
    section.querySelector('#lab-overlap-value').textContent = `${sliderOverlap.value}%`;

    machines.forEach(({ kind, panel }) => {
      fillSlots(panel, { equation: equationFor(kind) });
      setResult(panel, null);
    });
    const side = machines.find(({ kind }) => kind === 'side');
    fillSlots(side.panel, { note: 'The total is over 100%, so these events can’t be mutually exclusive.' });
    side.panel.querySelector('[data-slot="note"]').hidden = MarbleModel.fits(readConfig('side'));
  }

  function applyControls() {
    refreshReadouts();
    machines.forEach(({ kind, machine }) => machine.setConfig(readConfig(kind)));
    dropButton.disabled = false;
  }

  function dropAll() {
    dropButton.disabled = true;
    bringIntoView(section.querySelector('.lab__machines'));

    let pending = 0;
    const finished = () => {
      pending -= 1;
      if (pending > 0) return;
      dropButton.disabled = false;
      announce('Run finished. Results are listed under each machine.');
    };
    machines.forEach(({ panel, machine }) => {
      pending += 1;
      const started = machine.run(100, {
        onProgress: (stats) => setResult(panel, stats),
        onDone: finished,
      });
      if (!started) pending -= 1;
    });
  }

  [sliderA, sliderB, sliderOverlap].forEach((control) => {
    control.addEventListener('input', applyControls);
  });
  dropButton.addEventListener('click', dropAll);

  refreshReadouts();

  function leave() {
    if (machines.some(({ machine }) => machine.running)) applyControls();
  }

  return { section, show() {}, leave };
}

/* ---------- Practice screen ---------- */

const ANSWER_NAMES = {
  stack: 'Independent',
  dependent: 'Dependent',
  side: 'Mutually Exclusive',
  overlap: 'Not Mutually Exclusive',
};

const PROMPTS = {
  type: 'What type of event is this?',
  math: 'What is the correct math?',
};

function setupPractice() {
  const section = document.getElementById('practice');
  const question = section.querySelector('[data-question]');
  const finish = section.querySelector('[data-finish]');
  const feedback = section.querySelector('[data-feedback]');
  const nextButton = section.querySelector('[data-next-question]');
  const answerButtons = section.querySelectorAll('[data-answer]');
  const retryTag = section.querySelector('[data-retry-tag]');
  const retryNote = section.querySelector('[data-retry-note]');
  const stage = section.querySelector('.stage');
  const canvas = section.querySelector('canvas');
  const machine = new Machine(canvas, {
    pA: 50,
    pB: 50,
    layout: 'stack',
  });

  // Questions not asked yet, by kind. New rounds use these first, so nothing repeats
  // until every question has been asked.
  const unasked = {};
  let queue = [];
  let firstTries = 0;
  let wrongFirstTries = 0;
  let total = 0;

  /** Picks the same number of each kind, half asking for the type of event and half for the math. */
  function pickQuestions() {
    return shuffled(Object.keys(KINDS).flatMap((kind) => {
      if (!unasked[kind] || unasked[kind].length < QUESTIONS_PER_KIND) {
        unasked[kind] = shuffled(SCENARIOS.filter((scenario) => scenario.kind === kind));
      }
      const picked = unasked[kind].splice(0, QUESTIONS_PER_KIND);
      const asks = shuffled(picked.map((_, index) => (index % 2 === 0 ? 'type' : 'math')));
      return picked.map((scenario, index) => ({ scenario, ask: asks[index], retry: false }));
    }));
  }

  function hideMachine() {
    machine.setGuess(null);
    machine.setGatesVisible(false);
    stage.classList.add('is-waiting');
  }

  function showQuestion() {
    const { scenario, ask, retry } = queue[0];
    machine.setConfig({ pA: 50, pB: 50, ...KINDS.stack });
    hideMachine();

    fillSlots(question, {
      text: scenario.text,
      progress: `${total - queue.length + 1} of ${total}`,
      prompt: PROMPTS[ask],
    });
    retryTag.hidden = !retry;
    feedback.hidden = true;

    // Math answers are shuffled, so a button's place doesn't give away its kind.
    const kinds = ask === 'math' ? shuffled(Object.keys(KINDS)) : Object.keys(KINDS);
    answerButtons.forEach((button, index) => {
      const kind = kinds[index];
      button.dataset.answer = kind;
      button.querySelector('strong').textContent = ask === 'math' ? scenario.answers[kind] : ANSWER_NAMES[kind];
      button.classList.toggle('answer--math', ask === 'math');
      button.disabled = false;
      button.classList.remove('is-correct', 'is-wrong');
    });
  }

  function answer(chosen) {
    const item = queue.shift();
    const { scenario } = item;
    const isCorrect = chosen === scenario.kind;
    if (!isCorrect && !item.retry) wrongFirstTries += 1;

    // A missed question comes back at the end of the round, marked as a second try.
    if (!isCorrect) {
      queue.push({ ...item, retry: true });
      total += 1;
    }
    retryNote.hidden = isCorrect;

    answerButtons.forEach((button) => {
      button.disabled = true;
      if (button.dataset.answer === chosen) button.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
    });

    stage.classList.remove('is-waiting');
    bringIntoView(canvas);
    machine.setGatesVisible(true);
    machine.setConfig(scenarioConfig(scenario));
    // The diamond marks how many marbles the math predicts will reach the bottom.
    machine.setGuess(Math.round(MarbleModel.expectedPercent(machine.config)));

    const verdict = isCorrect ? 'Correct.' : 'Incorrect.';
    const kindName = KIND_NAMES[scenario.kind];
    // A wrong answer says why that choice doesn't fit, then names the right kind.
    const reason = `${scenario.why.charAt(0).toLowerCase()}${scenario.why.slice(1)}`;
    const why = isCorrect
      ? `${kindName}: ${scenario.why}`
      : `${MISTAKES[scenario.kind][chosen]} It’s ${kindName.toLowerCase()}: ${reason}`;
    fillSlots(feedback, { verdict, why, equation: scenario.equation, landed: '' });
    const verdictText = feedback.querySelector('[data-slot="verdict"]');
    verdictText.classList.toggle('verdict--correct', isCorrect);
    verdictText.classList.toggle('verdict--wrong', !isCorrect);
    feedback.hidden = false;
    nextButton.disabled = true;
    announce(`${verdict} ${why} ${scenario.equation}`);

    machine.run(100, {
      onDone: (stats) => {
        const predicted = Math.round(MarbleModel.expectedPercent(machine.config));
        fillSlots(feedback, { landed: `Reached the bottom: ${stats.landed} of 100. Math predicts about ${predicted}.` });
        nextButton.disabled = false;
        nextButton.focus({ preventScroll: true });
      },
    });
  }

  function showFinish() {
    question.hidden = true;
    finish.hidden = false;
    fillSlots(finish, { score: `${firstTries - wrongFirstTries} of ${firstTries}` });
    hideMachine();
  }

  function start() {
    queue = pickQuestions();
    total = queue.length;
    firstTries = queue.length;
    wrongFirstTries = 0;
    question.hidden = false;
    finish.hidden = true;
    showQuestion();
  }

  answerButtons.forEach((button) => {
    button.addEventListener('click', () => answer(button.dataset.answer));
  });
  nextButton.addEventListener('click', () => {
    if (queue.length === 0) showFinish();
    else showQuestion();
  });
  section.querySelector('[data-again]').addEventListener('click', start);

  start();

  function leave() {
    if (!machine.running) return;
    machine.reset();
    nextButton.disabled = false;
  }

  return { section, show() {}, leave };
}

/* ---------- Moving between screens ---------- */

function setupNavigation() {
  const experiment = setupExperiment();
  const lab = setupLab();
  const practice = setupPractice();
  const summary = { section: document.getElementById('summary'), show() {}, leave() {} };

  // Steps are grouped in the bar: the two "and" kinds, the two "or" kinds, then review.
  const groups = ['A and B', 'A or B', 'Review'];
  const screens = [
    { name: 'Independent', group: 0, view: experiment, show: () => experiment.show('stack') },
    { name: 'Dependent', group: 0, view: experiment, show: () => experiment.show('dependent') },
    { name: 'Mutually Exclusive', group: 1, view: experiment, show: () => experiment.show('side') },
    { name: 'Not Mutually Exclusive', group: 1, view: experiment, show: () => experiment.show('overlap') },
    { name: 'Compare', group: 2, view: lab, show: () => lab.show() },
    { name: 'Practice', group: 2, view: practice, show: () => practice.show() },
    { name: 'Summary', group: 2, view: summary, show: () => summary.show() },
  ];

  const stepList = document.getElementById('steps');
  const backButton = document.getElementById('back');
  const nextButton = document.getElementById('next');
  let current = 0;

  const groupLists = groups.map((label) => {
    const item = document.createElement('li');
    const list = document.createElement('ul');
    item.className = 'steps__group';
    list.className = 'steps__list';
    list.setAttribute('aria-label', label);
    item.append(list);
    stepList.append(item);
    return list;
  });

  const stepButtons = screens.map((screen, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const name = document.createElement('span');
    button.className = 'step';
    button.type = 'button';
    name.className = 'step__name';
    name.textContent = screen.name;
    button.append(name);
    button.setAttribute('aria-label', `Step ${index + 1}: ${screen.name}`);
    button.addEventListener('click', () => goTo(index));
    item.append(button);
    groupLists[screen.group].append(item);
    return button;
  });

  function updateBars() {
    stepButtons.forEach((button, index) => {
      if (index === current) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    backButton.style.visibility = current === 0 ? 'hidden' : 'visible';
    const following = screens[current + 1];
    nextButton.textContent = following ? `Next: ${following.name}` : 'Start Over';
  }

  function goTo(index) {
    if (index < 0 || index >= screens.length) return;
    screens[current].view.leave();
    screens[current].view.section.hidden = true;

    current = index;
    const { view, show } = screens[current];
    view.section.hidden = false;
    view.section.scrollTop = 0;
    show();
    updateBars();

    const heading = [...view.section.querySelectorAll('h2')].find((h2) => h2.offsetParent !== null);
    if (heading) heading.focus({ preventScroll: true });
  }

  backButton.addEventListener('click', () => goTo(current - 1));
  nextButton.addEventListener('click', () => {
    if (current === screens.length - 1) window.location.reload();
    else goTo(current + 1);
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, select, textarea')) return;
    if (event.key === 'ArrowRight') goTo(current + 1);
    if (event.key === 'ArrowLeft') goTo(current - 1);
  });

  updateBars();
}

function setupExplosionsToggle() {
  const toggle = document.getElementById('explosions-toggle');
  // Some browsers restore a checkbox after a reload, so always start from off.
  toggle.checked = false;
  toggle.addEventListener('change', () => {
    // A broken machine has garbled text all over the page, so start it again from scratch.
    if (!toggle.checked && Explosions.isBroken()) window.location.reload();
    else Explosions.setEnabled(toggle.checked);
  });
}

setupNavigation();
setupExplosionsToggle();
