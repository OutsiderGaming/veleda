// Practice mode's scripted market (hackathon spec, "Practice mode"): a
// fictional event, fixed opening prices and fixed moves by other traders, so
// the story plays the same every time. Run it through the reference model
// (packages/reference) to get every figure; scripts/practice-scenario.ts
// prints the beats.

export const DAY = 86_400;

export const SCENARIO = {
  question: "When will Luna the cat have her kittens?",
  /** Ten daily atoms plus "not by day 10". */
  atoms: 10,
  atomSeconds: DAY,
  startTime: 0,
  b: 100,
  /** Locked zone: one day. */
  lockSeconds: DAY,
  lagSeconds: 6 * 3_600,
  /** Opening prices: a gentle bump around days 5–7, and 62% that it takes longer than ten days. */
  endPrice: 0.62,
  shape: [5, 6, 7, 8, 9, 10, 10, 9, 8, 7],
  /** The user's suggested window: days 6–7 (atoms 5 and 6), 20 VCR. */
  window: { from: 5, to: 6 },
  stake: 20,
  /** When it happens: day 7 (atom 6), 3 a.m. */
  winner: 6,
  happensAt: 6 * DAY + 3 * 3_600,
};

export type Step =
  | { at: number; kind: "trade"; from: number; to: number; stake: number }
  | { at: number; kind: "beat"; id: string; caption: string };

/**
 * The story, in market time (seconds from the start of day 1). "trade" steps
 * are other traders; "beat" steps are where the caption changes and the
 * slider snaps.
 */
export const STEPS: Step[] = [
  { at: 0, kind: "beat", id: "question", caption: "Every market is one question about when something will happen. This one asks when Luna the cat will have her kittens." },
  { at: 1 * 3_600, kind: "beat", id: "timeline", caption: "Below the question, time is split into slots: days, in this case. The bronze bars are wider when more people have guessed that slot. The bottom bar predicts that it won't happen during the timeline at all." },
  { at: 2 * 3_600, kind: "beat", id: "pick", caption: "Hold a day to select it. Drag to choose a whole region. Narrow bars give better odds." },
  { at: 3 * 3_600, kind: "beat", id: "buy", caption: "Make the call: 20 VCR on days 6–7." },
  { at: 10 * 3_600, kind: "trade", from: 2, to: 3, stake: 15 },
  { at: 20 * 3_600, kind: "trade", from: 8, to: 9, stake: 10 },
  { at: 30 * 3_600, kind: "trade", from: 4, to: 5, stake: 12 },
  { at: 2 * DAY + 12 * 3_600, kind: "beat", id: "time", caption: "Two days pass. Days that have gone grey out and drop away, so the odds on the days left go up, and so does your window's value." },
  { at: 3 * DAY + 9 * 3_600, kind: "trade", from: 5, to: 7, stake: 40 },
  { at: 3 * DAY + 10 * 3_600, kind: "trade", from: 5, to: 6, stake: 30 },
  { at: 3 * DAY + 11 * 3_600, kind: "trade", from: 6, to: 6, stake: 25 },
  { at: 3 * DAY + 12 * 3_600, kind: "beat", id: "news", caption: "News: the vet says \"any day now, probably day 6 or 7\". Traders pile in, and your slots shoot up in value." },
  { at: 3 * DAY + 13 * 3_600, kind: "beat", id: "choice", caption: "Cash out now, or hold for the full payout?" },
  { at: 4 * DAY + 12 * 3_600, kind: "beat", id: "locked", caption: "There is no buying and selling of slots within the next 24 hours, which means predictions are \"locked in\" within that time." },
  { at: 6 * DAY + 3 * 3_600, kind: "beat", id: "happens", caption: "Day 7, 3 a.m.: the kittens arrive. Windows that contain the moment pay 1 VCR per share." },
];
