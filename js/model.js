'use strict';

/*
 * The probability model behind the machine. No DOM and no drawing, so the math
 * can be tested on its own.
 *
 * Positions and probabilities are percentages of the wall's width (0 to 100).
 * Each marble gets random positions, and the doors decide what happens to it,
 * so the counts vary from run to run around the probability.
 *
 * A config looks like: { pA: 50, pB: 30, layout: 'stack' | 'side' }, plus optional
 * overlap (how much the doors share) and shuffler: false (stacked gates with no
 * shuffler, so a marble keeps its position from Gate A to Gate B).
 */
const MarbleModel = (() => {
  const WALL = 100;

  // Tolerance so that sums like 1/6 + 5/6 aren't rejected over rounding error.
  const EPSILON = 1e-9;

  function centeredDoor(width) {
    const start = (WALL - width) / 2;
    return { start, end: start + width };
  }

  /** Side-by-side doors, and stacked gates with no shuffler and a set overlap, share the overlap. */
  function linesUp({ layout, overlap, shuffler }) {
    return layout === 'side' || (shuffler === false && overlap !== undefined);
  }

  /** Two doors edge to edge, sharing the overlap, centered together on the wall. */
  function edgeToEdge(pA, pB, shared) {
    const start = (WALL - pA - pB + shared) / 2;
    const startB = start + pA - shared;
    return {
      a: { start, end: start + pA },
      b: { start: startB, end: startB + pB },
    };
  }

  function doorsFor(config) {
    const { pA, pB, layout, overlap } = config;
    if (layout === 'side') return edgeToEdge(pA, pB, overlap || 0);

    const a = centeredDoor(pA);
    if (!linesUp(config)) return { a, b: centeredDoor(pB) };

    // Without the shuffler, Gate B shifts over from Gate A until only the overlap lines up.
    const right = a.end - overlap;
    if (right + pB <= WALL + EPSILON) return { a, b: { start: right, end: right + pB } };
    const left = a.start + overlap - pB;
    if (left >= -EPSILON) return { a, b: { start: left, end: left + pB } };
    return edgeToEdge(pA, pB, overlap);
  }

  /** Doors that line up share one wall's width, so together they can't be wider than it. */
  function fits(config) {
    const { pA, pB, overlap } = config;
    return !linesUp(config) || pA + pB - (overlap || 0) <= WALL + EPSILON;
  }

  function sharedWidth(a, b) {
    return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  }

  /** Percentage of marbles that reach the bottom. */
  function expectedPercent(config) {
    const { pA, pB, layout } = config;
    const { a, b } = doorsFor(config);
    if (layout === 'side') return pA + pB - sharedWidth(a, b);
    // Without the shuffler, a marble reaches the bottom only where the doors line up.
    if (config.shuffler === false) return sharedWidth(a, b);
    return (pA * pB) / WALL;
  }

  const isInside = (door, position) => position >= door.start && position < door.end;

  function planSideRoute(config, random) {
    const { a, b } = doorsFor(config);
    const entry = random() * WALL;
    const inA = isInside(a, entry);
    const inB = isInside(b, entry);
    let outcome = 'missed';
    if (inA && inB) outcome = 'both';
    else if (inA) outcome = 'a';
    else if (inB) outcome = 'b';
    return { entry, exit: entry, outcome };
  }

  function planStackRoute(config, random) {
    const { a, b } = doorsFor(config);
    const entry = random() * WALL;
    if (!isInside(a, entry)) return { entry, exit: entry, outcome: 'stoppedA' };

    // The shuffler gives a marble a new position between the gates, so passing
    // Gate A has no effect on what happens at Gate B. Without it, the marble keeps its position.
    const exit = config.shuffler === false ? entry : random() * WALL;
    return { entry, exit, outcome: isInside(b, exit) ? 'both' : 'stoppedB' };
  }

  /**
   * Plans every marble in a run. Each route has an entry position, an exit position,
   * and an outcome: 'both' | 'a' | 'b' | 'stoppedA' | 'stoppedB' | 'missed'.
   */
  function planRun(config, total, random = Math.random) {
    const planRoute = config.layout === 'side' ? planSideRoute : planStackRoute;
    return Array.from({ length: total }, () => planRoute(config, random));
  }

  /**
   * Makes a damaged machine misbehave: at chaos 0 routes are untouched, in between
   * some marbles ignore the doors, and at chaos 1 every marble is 'lost' through the floor.
   */
  function scrambleRoutes(routes, layout, chaos, random = Math.random) {
    if (chaos <= 0) return routes;
    if (chaos >= 1) return routes.map((route) => ({ ...route, outcome: 'lost' }));

    const outcomes = layout === 'side' ? ['a', 'b', 'missed'] : ['both', 'stoppedA', 'stoppedB'];
    return routes.map((route) => {
      if (random() >= chaos) return route;
      return { ...route, outcome: outcomes[Math.floor(random() * outcomes.length)] };
    });
  }

  function emptyStats(total) {
    return { total, dropped: 0, stoppedA: 0, stoppedB: 0, missed: 0, landed: 0, landedA: 0, landedB: 0 };
  }

  /** Marbles are tallied at a stop as soon as they reach it, so this runs mid-flight. */
  function recordStop(stats, outcome) {
    if (outcome === 'stoppedA') stats.stoppedA += 1;
    else if (outcome === 'stoppedB') stats.stoppedB += 1;
    else if (outcome === 'missed' || outcome === 'lost') stats.missed += 1;
  }

  function recordLanding(stats, outcome) {
    stats.landed += 1;
    if (outcome === 'a') stats.landedA += 1;
    else if (outcome === 'b') stats.landedB += 1;
  }

  /** Runs a whole batch instantly, for visitors who have reduced motion turned on. */
  function simulate(config, total, random = Math.random) {
    const stats = emptyStats(total);
    planRun(config, total, random).forEach(({ outcome }) => {
      stats.dropped += 1;
      if (outcome === 'both' || outcome === 'a' || outcome === 'b') recordLanding(stats, outcome);
      else recordStop(stats, outcome);
    });
    return stats;
  }

  return { doorsFor, fits, expectedPercent, planRun, scrambleRoutes, emptyStats, recordStop, recordLanding, simulate };
})();

if (typeof module !== 'undefined') module.exports = MarbleModel;
