import { withTransaction } from "../db.js";
import { newRatings } from "../elo.js";
import type { Match } from "./match.js";

// Persist a completed/abandoned match: scores, ratings (Elo), stats, streaks.
export async function persistMatchResult(match: Match): Promise<void> {
  if (match.winner === null) return;
  const [a, b] = match.players;
  const winnerSide = match.winner;
  const loserSide = winnerSide === 0 ? 1 : 0;
  const winner = match.players[winnerSide];
  const loser = match.players[loserSide];
  const endedAt = match.endedAt ?? Date.now();
  const durationMs = endedAt - match.startedAt;

  await withTransaction(async (client) => {
    // create match row if not exists (manager pre-creates it; upsert safe)
    await client.query(
      `INSERT INTO matches (id, mode, status, server_user_id, client_user_id,
         winner_user_id, score_a, score_b, current_server, points_since_serve,
         started_at, ended_at, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         winner_user_id = EXCLUDED.winner_user_id,
         score_a = EXCLUDED.score_a,
         score_b = EXCLUDED.score_b,
         ended_at = EXCLUDED.ended_at,
         duration_ms = EXCLUDED.duration_ms`,
      [
        match.id,
        match.mode,
        match.finishReason === "completed" ? "finished" : "abandoned",
        a.userId,
        b.userId,
        winner.userId,
        match.score[0],
        match.score[1],
        match.serverSide,
        match.pointsSinceServe,
        new Date(match.startedAt),
        new Date(endedAt),
        durationMs,
      ],
    );

    // fetch current ratings under lock
    const ra = await client.query<{ rating: number }>(
      "SELECT rating FROM users WHERE id = $1 FOR UPDATE",
      [a.userId],
    );
    const rb = await client.query<{ rating: number }>(
      "SELECT rating FROM users WHERE id = $1 FOR UPDATE",
      [b.userId],
    );
    const ratingA = ra.rows[0]?.rating ?? a.rating;
    const ratingB = rb.rows[0]?.rating ?? b.rating;
    const { aNew, bNew } = newRatings(
      ratingA,
      ratingB,
      winnerSide === 0,
    );
    const newRating = [aNew, bNew] as const;

    for (const p of match.players) {
      const isWinner = p.side === winnerSide;
      const ratingAfter = newRating[p.side];
      const pointsWon = p.side === 0 ? match.score[0] : match.score[1];
      await client.query(
        `INSERT INTO match_players (match_id, user_id, side, rating_before, rating_after, result, points_won)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (match_id, user_id) DO UPDATE SET
           rating_before = EXCLUDED.rating_before,
           rating_after = EXCLUDED.rating_after,
           result = EXCLUDED.result,
           points_won = EXCLUDED.points_won`,
        [
          match.id,
          p.userId,
          p.side,
          p.side === 0 ? ratingA : ratingB,
          ratingAfter,
          isWinner ? 1 : 0,
          pointsWon,
        ],
      );
      await client.query(
        `UPDATE users SET
           rating = $2,
           wins = wins + $3,
           losses = losses + $4,
           current_streak = CASE WHEN $3 = 1 THEN current_streak + 1 ELSE 0 END,
           best_streak = GREATEST(best_streak, CASE WHEN $3 = 1 THEN current_streak + 1 ELSE 0 END)
         WHERE id = $1`,
        [p.userId, ratingAfter, isWinner ? 1 : 0, isWinner ? 0 : 1],
      );
      await client.query(
        `UPDATE player_profiles SET rating = $2, updated_at = now() WHERE user_id = $1`,
        [p.userId, ratingAfter],
      );
      await client.query(
        `UPDATE player_statistics SET
           matches_played = matches_played + 1,
           points_won = points_won + $2,
           points_lost = points_lost + $3,
           longest_rally = GREATEST(longest_rally, $4),
           updated_at = now()
         WHERE user_id = $1`,
        [
          p.userId,
          p.side === 0 ? match.score[0] : match.score[1],
          p.side === 0 ? match.score[1] : match.score[0],
          match.longestRally,
        ],
      );
      await client.query(
        `INSERT INTO player_ratings (user_id, rating, matches_played)
         VALUES ($1, $2, 1)`,
        [p.userId, ratingAfter],
      );
    }
  });
}
