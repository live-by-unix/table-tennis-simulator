import { describe, it, expect } from "vitest";
import { expectedScore, newRatings, eloDelta, STARTING_RATING } from "../src/elo.js";

describe("elo", () => {
  it("equal players expect 0.5", () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5);
  });
  it("winner gains points vs lower rated", () => {
    const { aNew, bNew } = newRatings(1200, 1000, true);
    expect(aNew).toBeGreaterThan(1200);
    expect(bNew).toBeLessThan(1000);
  });
  it("upset gains more", () => {
    const upset = eloDelta(1000, 1400);
    const expected = eloDelta(1400, 1000);
    expect(upset).toBeGreaterThan(expected);
  });
  it("ratings never go below 0", () => {
    const { aNew, bNew } = newRatings(10, 2000, false);
    expect(aNew).toBeGreaterThanOrEqual(0);
    expect(bNew).toBeGreaterThanOrEqual(0);
  });
  it("starting rating constant", () => {
    expect(STARTING_RATING).toBe(1200);
  });
});
