export const STARTING_RATING = 1200;
export const ELO_K = 32;

export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

export function eloDelta(winnerRating: number, loserRating: number): number {
  const expected = expectedScore(winnerRating, loserRating);
  return Math.round(ELO_K * (1 - expected));
}

export function newRatings(
  a: number,
  b: number,
  aWon: boolean,
): { aNew: number; bNew: number } {
  const expA = expectedScore(a, b);
  const aNew = Math.max(0, Math.round(a + ELO_K * ((aWon ? 1 : 0) - expA)));
  const expB = 1 - expA;
  const bNew = Math.max(0, Math.round(b + ELO_K * ((aWon ? 0 : 1) - expB)));
  return { aNew, bNew };
}
