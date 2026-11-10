'use strict';

/*
 * Practice questions. kind is 'stack' (independent: multiply), 'dependent'
 * (multiply by P(B | A)), 'side' (mutually exclusive: add) or 'overlap' (not
 * mutually exclusive: add, then subtract the overlap). overlap is P(A and B) for
 * dependent and not mutually exclusive questions. Exact fractions stay in pA, pB and
 * overlap so the marbles use the true odds, even though the labels show rounded percentages.
 *
 * answers holds the question's numbers worked out as each kind of event. Only the
 * answer for the question's own kind is correct, and the four always differ.
 */

/** How the machine is set up for each kind of event. */
const KINDS = {
  stack: { layout: 'stack', shuffler: true, overlap: undefined },
  dependent: { layout: 'stack', shuffler: false, overlap: undefined },
  // The shuffler stays off for doors in one wall, so it can't flash in while the gates move.
  side: { layout: 'side', shuffler: false, overlap: 0 },
  overlap: { layout: 'side', shuffler: false, overlap: 10 },
};

/**
 * Why a wrong answer doesn't fit, by the right kind and then the kind that was chosen.
 * "Both" questions (two results) and "either" questions (one result) are the main split.
 */
const MISTAKES = {
  stack: {
    dependent: 'Dependent means the first result changes the odds for the second.',
    side: 'Mutually exclusive is for one result, but this asks for two results together.',
    overlap: 'Not mutually exclusive is for one result, but this asks for two results together.',
  },
  dependent: {
    stack: 'Independent means the first result has no effect on the second.',
    side: 'Mutually exclusive is for one result, but this asks for two results together.',
    overlap: 'Not mutually exclusive is for one result, but this asks for two results together.',
  },
  side: {
    stack: 'Independent is for two results together, but this asks about one result.',
    dependent: 'Dependent is for two results in a row, but this asks about one result.',
    overlap: 'Not mutually exclusive means one result could be both.',
  },
  overlap: {
    stack: 'Independent is for two results together, but this asks about one result.',
    dependent: 'Dependent is for two results in a row, but this asks about one result.',
    side: 'Mutually exclusive means the two can’t happen together.',
  },
};

/** The machine that shows a question's answer. */
function scenarioConfig(scenario) {
  const { pA, pB, labelA, labelB, kind, overlap } = scenario;
  return {
    pA,
    pB,
    labelA,
    labelB,
    ...KINDS[kind],
    ...(overlap === undefined ? {} : { overlap }),
  };
}

const SCENARIOS = [
  // Independent: the first one goes back, so the second has the same odds.
  {
    text: 'A bag has 5 red and 5 blue marbles. You draw one, put it back, and draw again. What is the chance both are red?',
    kind: 'stack',
    labelA: 'Red 1',
    labelB: 'Red 2',
    pA: 50,
    pB: 50,
    answers: {
      stack: '5/10 × 5/10 = 25/100 = 25%',
      dependent: '5/10 × 4/9 = 20/90 ≈ 22.2%',
      side: '5/10 + 5/10 = 10/10 = 100%',
      overlap: '5/10 + 5/10 – 25/100 = 75/100 = 75%',
    },
    why: 'The first marble goes back, so the second draw has the same odds.',
  },
  {
    text: 'You draw a card from a standard deck, put it back, shuffle, and draw again. What is the chance both are hearts?',
    kind: 'stack',
    labelA: 'Heart 1',
    labelB: 'Heart 2',
    pA: 25,
    pB: 25,
    answers: {
      stack: '13/52 × 13/52 = 169/2704 = 6.25%',
      dependent: '13/52 × 12/51 = 156/2652 ≈ 5.9%',
      side: '13/52 + 13/52 = 26/52 = 50%',
      overlap: '13/52 + 13/52 – 169/2704 = 1183/2704 = 43.75%',
    },
    why: 'The card goes back and the deck is shuffled, so the second draw has the same odds.',
  },
  {
    text: 'A class has 6 girls and 4 boys. The teacher picks a name, puts it back, and picks again. What is the chance both picks are girls?',
    kind: 'stack',
    labelA: 'Girl 1',
    labelB: 'Girl 2',
    pA: 60,
    pB: 60,
    answers: {
      stack: '6/10 × 6/10 = 36/100 = 36%',
      dependent: '6/10 × 5/9 = 30/90 ≈ 33.3%',
      side: '6/10 + 6/10 = 12/10 = 120%',
      overlap: '6/10 + 6/10 – 36/100 = 84/100 = 84%',
    },
    why: 'The name goes back, so the second pick has the same odds.',
  },
  {
    text: 'A drawer has 3 black socks and 2 white socks. You pull one out, put it back, and pull again. What is the chance both are black?',
    kind: 'stack',
    labelA: 'Black 1',
    labelB: 'Black 2',
    pA: 60,
    pB: 60,
    answers: {
      stack: '3/5 × 3/5 = 9/25 = 36%',
      dependent: '3/5 × 2/4 = 6/20 = 30%',
      side: '3/5 + 3/5 = 6/5 = 120%',
      overlap: '3/5 + 3/5 – 9/25 = 21/25 = 84%',
    },
    why: 'The sock goes back, so the second pull has the same odds.',
  },

  // Dependent: the first one stays out, which changes the odds for the second.
  {
    text: 'A bag has 5 red and 5 blue marbles. You draw two without putting the first back. What is the chance both are red?',
    kind: 'dependent',
    labelA: 'Red 1',
    labelB: 'Red 2',
    pA: 50,
    pB: 50,
    overlap: (5 / 10) * (4 / 9) * 100,
    answers: {
      stack: '5/10 × 5/10 = 25/100 = 25%',
      dependent: '5/10 × 4/9 = 20/90 ≈ 22.2%',
      side: '5/10 + 5/10 = 10/10 = 100%',
      overlap: '5/10 + 5/10 – 20/90 = 70/90 ≈ 77.8%',
    },
    why: 'Taking out a red marble leaves fewer reds for the second draw.',
  },
  {
    text: 'You draw two cards from a standard deck without putting the first back. What is the chance both are hearts?',
    kind: 'dependent',
    labelA: 'Heart 1',
    labelB: 'Heart 2',
    pA: 25,
    pB: 25,
    overlap: (13 / 52) * (12 / 51) * 100,
    answers: {
      stack: '13/52 × 13/52 = 169/2704 = 6.25%',
      dependent: '13/52 × 12/51 = 156/2652 ≈ 5.9%',
      side: '13/52 + 13/52 = 26/52 = 50%',
      overlap: '13/52 + 13/52 – 156/2652 = 1170/2652 ≈ 44.1%',
    },
    why: 'Once a heart is gone, fewer hearts are left for the second card.',
  },
  {
    text: 'A class has 6 girls and 4 boys. The teacher picks two different students at random. What is the chance both are girls?',
    kind: 'dependent',
    labelA: 'Girl 1',
    labelB: 'Girl 2',
    pA: 60,
    pB: 60,
    overlap: (6 / 10) * (5 / 9) * 100,
    answers: {
      stack: '6/10 × 6/10 = 36/100 = 36%',
      dependent: '6/10 × 5/9 = 30/90 ≈ 33.3%',
      side: '6/10 + 6/10 = 12/10 = 120%',
      overlap: '6/10 + 6/10 – 30/90 = 78/90 ≈ 86.7%',
    },
    why: 'The first student can’t be picked again, so fewer girls are left.',
  },
  {
    text: 'A drawer has 3 black socks and 2 white socks. You pull out two without looking. What is the chance both are black?',
    kind: 'dependent',
    labelA: 'Black 1',
    labelB: 'Black 2',
    pA: 60,
    pB: 60,
    overlap: (3 / 5) * (2 / 4) * 100,
    answers: {
      stack: '3/5 × 3/5 = 9/25 = 36%',
      dependent: '3/5 × 2/4 = 6/20 = 30%',
      side: '3/5 + 3/5 = 6/5 = 120%',
      overlap: '3/5 + 3/5 – 6/20 = 18/20 = 90%',
    },
    why: 'The first sock stays out, which changes what’s left in the drawer.',
  },

  // Mutually exclusive: one result can't be both.
  {
    text: 'You draw one card from a standard 52-card deck. What is the chance it is an ace or a king?',
    kind: 'side',
    labelA: 'Ace',
    labelB: 'King',
    pA: (4 / 52) * 100,
    pB: (4 / 52) * 100,
    answers: {
      stack: '4/52 × 4/52 = 16/2704 ≈ 0.6%',
      dependent: '4/52 × 0 = 0 = 0%',
      side: '4/52 + 4/52 = 8/52 ≈ 15.4%',
      overlap: '4/52 + 4/52 – 16/2704 = 400/2704 ≈ 14.8%',
    },
    why: 'One card can’t be both an ace and a king.',
  },
  {
    text: 'You roll one die. What is the chance it shows a 1 or a 6?',
    kind: 'side',
    labelA: 'Roll 1',
    labelB: 'Roll 6',
    pA: 100 / 6,
    pB: 100 / 6,
    answers: {
      stack: '1/6 × 1/6 = 1/36 ≈ 2.8%',
      dependent: '1/6 × 0 = 0 = 0%',
      side: '1/6 + 1/6 = 2/6 ≈ 33.3%',
      overlap: '1/6 + 1/6 – 1/36 = 11/36 ≈ 30.6%',
    },
    why: 'A single roll shows only one face.',
  },
  {
    text: 'A spinner lands on red 25% of the time and blue 40% of the time. On one spin, what is the chance it lands on red or blue?',
    kind: 'side',
    labelA: 'Red',
    labelB: 'Blue',
    pA: 25,
    pB: 40,
    answers: {
      stack: '0.25 × 0.4 = 0.1 = 10%',
      dependent: '0.25 × 0 = 0 = 0%',
      side: '0.25 + 0.4 = 0.65 = 65%',
      overlap: '0.25 + 0.4 – 0.1 = 0.55 = 55%',
    },
    why: 'One spin lands on only one color.',
  },
  {
    text: 'In a survey where everyone picks one favorite food, 35% pick pizza and 20% pick tacos. What is the chance a random person picked pizza or tacos?',
    kind: 'side',
    labelA: 'Pizza',
    labelB: 'Tacos',
    pA: 35,
    pB: 20,
    answers: {
      stack: '0.35 × 0.2 = 0.07 = 7%',
      dependent: '0.35 × 0 = 0 = 0%',
      side: '0.35 + 0.2 = 0.55 = 55%',
      overlap: '0.35 + 0.2 – 0.07 = 0.48 = 48%',
    },
    why: 'Each person picks only one food.',
  },

  // Not mutually exclusive: some results are both, so they would be counted twice.
  {
    text: 'On a given day there is a 30% chance of rain, a 50% chance of wind, and a 20% chance of both. What is the chance of rain or wind?',
    kind: 'overlap',
    labelA: 'Rain',
    labelB: 'Wind',
    pA: 30,
    pB: 50,
    overlap: 20,
    answers: {
      stack: '0.3 × 0.5 = 0.15 = 15%',
      dependent: '0.3 × 2/3 = 0.2 = 20%',
      side: '0.3 + 0.5 = 0.8 = 80%',
      overlap: '0.3 + 0.5 – 0.2 = 0.6 = 60%',
    },
    why: 'Some days have both rain and wind, and adding would count those days twice.',
  },
  {
    text: 'You roll one die. What is the chance it is even or greater than 3?',
    kind: 'overlap',
    labelA: 'Even',
    labelB: 'Over 3',
    pA: 100 / 2,
    pB: 100 / 2,
    overlap: 100 / 3,
    answers: {
      stack: '3/6 × 3/6 = 9/36 = 25%',
      dependent: '3/6 × 2/3 = 6/18 ≈ 33.3%',
      side: '3/6 + 3/6 = 6/6 = 100%',
      overlap: '3/6 + 3/6 – 2/6 = 4/6 ≈ 66.7%',
    },
    why: 'Rolling a 4 or a 6 makes both true.',
  },
  {
    text: 'In a class, 60% of students play a sport, 30% play an instrument, and 20% do both. What is the chance a student plays a sport or an instrument?',
    kind: 'overlap',
    labelA: 'Sport',
    labelB: 'Instrument',
    pA: 60,
    pB: 30,
    overlap: 20,
    answers: {
      stack: '0.6 × 0.3 = 0.18 = 18%',
      dependent: '0.6 × 1/3 = 0.2 = 20%',
      side: '0.6 + 0.3 = 0.9 = 90%',
      overlap: '0.6 + 0.3 – 0.2 = 0.7 = 70%',
    },
    why: 'Some students do both, and adding would count them twice.',
  },
  {
    text: 'At a park, 40% of people have a dog, 25% have a bike, and 15% have both. What is the chance a person has a dog or a bike?',
    kind: 'overlap',
    labelA: 'Dog',
    labelB: 'Bike',
    pA: 40,
    pB: 25,
    overlap: 15,
    answers: {
      stack: '0.4 × 0.25 = 0.1 = 10%',
      dependent: '0.4 × 0.375 = 0.15 = 15%',
      side: '0.4 + 0.25 = 0.65 = 65%',
      overlap: '0.4 + 0.25 – 0.15 = 0.5 = 50%',
    },
    why: 'Some people have both, and adding would count them twice.',
  },
].map((scenario) => ({ ...scenario, equation: scenario.answers[scenario.kind] }));

if (typeof module !== 'undefined') module.exports = { KINDS, MISTAKES, SCENARIOS, scenarioConfig };
