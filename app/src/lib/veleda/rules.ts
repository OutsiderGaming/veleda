// Full resolution criteria per market, shown from the market screen ("View resolution criteria").
// The one-line summary on market cards is `resolves` in markets.json.
// Flagship rule: CLAUDE.md "Flagship resolution" and the hackathon spec. The 10 outlets and the
// 5-of-10 quorum are still drafts there; change them here when they're final.
import { endLabel, type TimelineMarket } from "./timeline";

export interface Rules {
  /** Paragraphs, in order. */
  body: string[];
  /** Trusted sources, if the market names them. */
  sources?: { quorum: string; outlets: string[] };
  /** Paragraphs after the sources. */
  after?: string[];
}

type M = Pick<TimelineMarket, "atoms" | "atomSeconds" | "startTime"> & { lockSeconds: number };

const settle = "Once the result is in, Veleda records the winning slot on-chain. Every window that contains it pays 1 VCR per share, which you claim from Positions. All other windows pay nothing.";
const hours = (n: number) => (n === 1 ? "an hour" : `${n} hours`);
const lock = (m: M) => `Windows starting within ${hours(m.lockSeconds / 3600)} of now can't be bought or sold, so nobody can trade on news that has just broken.`;

const RULES: Record<string, (m: M) => Rules> = {
  flagship: (m) => ({
    body: [
      "This market resolves to the calendar date on which Taylor Swift's first child is born, in local time at the place of birth. The date of the birth counts, not the date it's announced.",
    ],
    sources: {
      quorum: "The date must be reported by at least 5 of these 10 outlets:",
      outlets: ["Associated Press", "Reuters", "BBC News", "CNN", "The New York Times", "People", "TMZ", "E! News", "Billboard", "Variety"],
    },
    after: [
      "If the outlets disagree, the date reported by the most outlets wins.",
      "If fewer than 5 report a date, the market stays open and unresolved until they do, however long that takes.",
      `If the birth hasn't happened by the last day on the timeline, “${endLabel(m)}” wins.`,
      settle,
      lock(m),
    ],
  }),
  fast: (m) => ({
    body: [
      "A staged event, run live during the demo so you can see a market resolve. The hour in which the event is triggered is the winning slot.",
      "This market's clock can be moved forward on camera, so its hours pass faster than real time.",
      `If the event hasn't happened by the end of the timeline, “${endLabel(m)}” wins.`,
      settle,
      lock(m),
    ],
  }),
};

export function rulesFor(name: string, m: M): Rules | null {
  return RULES[name]?.(m) ?? null;
}
