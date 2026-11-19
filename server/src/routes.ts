import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { query } from "./db.js";
import {
  createUser,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  destroySession,
  destroyAllSessions,
  getSessionUser,
  hashPassword,
  verifyPassword,
  publicUser,
  requireAuth,
} from "./auth.js";
import { isUsername } from "./util.js";
import { matchManager } from "./game/manager.js";

const registerSchema = z.object({
  username: z.string().min(3).max(20),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(128),
});

function err(statusCode: number, message: string) {
  const e = new Error(message) as Error & { statusCode: number };
  e.statusCode = statusCode;
  return e;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ---------- health ----------
  app.get("/api/v1/health", async () => {
    await query("SELECT 1");
    return { ok: true, ts: Date.now() };
  });

  // ---------- auth ----------
  app.post("/api/v1/auth/register", async (req, reply) => {
    const body = registerSchema.parse(req.body);
    if (!isUsername(body.username)) {
      throw err(400, "Username must be 3-20 chars: letters, numbers, underscore");
    }
    const { rows } = await query(
      "SELECT 1 FROM users WHERE username = $1",
      [body.username],
    );
    if (rows.length > 0) throw err(409, "Username already taken");
    const user = await createUser(body.username, body.password);
    const token = await createSession(user.id, req);
    setSessionCookie(reply, token);
    return { user: publicUser(user) };
  });

  app.post("/api/v1/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const { rows } = await query<{
      id: string;
      username: string;
      password_hash: string;
      rating: number;
      avatar: string | null;
      wins: number;
      losses: number;
      deleted_at: string | null;
    }>(
      "SELECT id, username, password_hash, rating, avatar, wins, losses, deleted_at FROM users WHERE username = $1",
      [body.username],
    );
    const row = rows[0];
    if (!row || row.deleted_at) throw err(401, "Invalid credentials");
    const ok = await verifyPassword(row.password_hash, body.password);
    if (!ok) throw err(401, "Invalid credentials");
    const token = await createSession(row.id, req);
    setSessionCookie(reply, token);
    return {
      user: publicUser({
        id: row.id,
        username: row.username,
        rating: row.rating,
        avatar: row.avatar,
        wins: row.wins,
        losses: row.losses,
      }),
    };
  });

  app.post("/api/v1/auth/logout", async (req, reply) => {
    await destroySession(req);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/v1/auth/me", async (req) => {
    const user = await getSessionUser(req);
    if (!user) return { user: null };
    return { user: publicUser(user) };
  });

  app.post("/api/v1/auth/change-password", async (req, reply) => {
    const user = await requireAuth(req);
    const body = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8).max(128),
      })
      .parse(req.body);
    const { rows } = await query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1",
      [user.id],
    );
    const row = rows[0];
    if (!row || !(await verifyPassword(row.password_hash, body.currentPassword))) {
      throw err(403, "Current password is incorrect");
    }
    const hash = await hashPassword(body.newPassword);
    await query("UPDATE users SET password_hash = $2 WHERE id = $1", [
      user.id,
      hash,
    ]);
    await destroyAllSessions(user.id);
    const token = await createSession(user.id, req);
    setSessionCookie(reply, token);
    return { ok: true };
  });

  app.delete("/api/v1/auth/account", async (req, reply) => {
    const user = await requireAuth(req);
    const body = z.object({ password: z.string().min(1) }).parse(req.body ?? {});
    const { rows } = await query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1",
      [user.id],
    );
    const row = rows[0];
    if (!row || !(await verifyPassword(row.password_hash, body.password))) {
      throw err(403, "Password is incorrect");
    }
    await query("UPDATE users SET deleted_at = now() WHERE id = $1", [user.id]);
    await destroyAllSessions(user.id);
    clearSessionCookie(reply);
    return { ok: true };
  });

  // ---------- profile ----------
  app.get("/api/v1/profile", async (req) => {
    const user = await requireAuth(req);
    const { rows } = await query(
      `SELECT u.id, u.username, u.rating, u.wins, u.losses, u.current_streak, u.best_streak,
              u.avatar, u.created_at,
              s.matches_played, s.points_won, s.points_lost, s.longest_rally
       FROM users u LEFT JOIN player_statistics s ON s.user_id = u.id
       WHERE u.id = $1`,
      [user.id],
    );
    return { profile: rows[0] ?? null };
  });

  app.get("/api/v1/profile/:username", async (req) => {
    const { username } = req.params as { username: string };
    const { rows } = await query(
      `SELECT u.id, u.username, u.rating, u.wins, u.losses, u.current_streak, u.best_streak,
              u.avatar, u.created_at,
              s.matches_played, s.points_won, s.points_lost, s.longest_rally
       FROM users u LEFT JOIN player_statistics s ON s.user_id = u.id
       WHERE u.username = $1 AND u.deleted_at IS NULL`,
      [username],
    );
    if (rows.length === 0) throw err(404, "Player not found");
    return { profile: rows[0] };
  });

  app.patch("/api/v1/profile", async (req) => {
    const user = await requireAuth(req);
    const body = z
      .object({
        avatar: z.string().max(2048).nullable().optional(),
        displayName: z.string().max(40).nullable().optional(),
      })
      .parse(req.body);
    if (body.avatar !== undefined) {
      await query("UPDATE users SET avatar = $2 WHERE id = $1", [
        user.id,
        body.avatar,
      ]);
    }
    if (body.displayName !== undefined) {
      await query(
        "UPDATE player_profiles SET display_name = $2, updated_at = now() WHERE user_id = $1",
        [user.id, body.displayName],
      );
    }
    return { ok: true };
  });

  // ---------- matches / history ----------
  app.get("/api/v1/matches", async (req) => {
    const user = await requireAuth(req);
    const { rows } = await query(
      `SELECT m.id, m.mode, m.status, m.score_a, m.score_b,
              m.started_at, m.ended_at, m.duration_ms, m.winner_user_id,
              a.username AS player_a, b.username AS player_b,
              ma.rating_before AS ra_before, ma.rating_after AS ra_after,
              mb.rating_before AS rb_before, mb.rating_after AS rb_after
       FROM matches m
       JOIN match_players ma ON ma.match_id = m.id AND ma.user_id = m.server_user_id
       JOIN match_players mb ON mb.match_id = m.id AND mb.user_id = m.client_user_id
       JOIN users a ON a.id = m.server_user_id
       JOIN users b ON b.id = m.client_user_id
       WHERE m.server_user_id = $1 OR m.client_user_id = $1
       ORDER BY m.created_at DESC LIMIT 50`,
      [user.id],
    );
    return { matches: rows };
  });

  app.get("/api/v1/matches/:id", async (req) => {
    const user = await requireAuth(req);
    const { id } = req.params as { id: string };
    const { rows } = await query(
      `SELECT m.*, a.username AS player_a, b.username AS player_b
       FROM matches m
       JOIN users a ON a.id = m.server_user_id
       JOIN users b ON b.id = m.client_user_id
       WHERE m.id = $1`,
      [id],
    );
    const match = rows[0];
    if (!match) throw err(404, "Match not found");
    if (match.server_user_id !== user.id && match.client_user_id !== user.id) {
      // allow spectating finished matches publicly? keep private unless finished
      if (match.status === "live") throw err(403, "Forbidden");
    }
    const { rows: players } = await query(
      `SELECT mp.side, mp.rating_before, mp.rating_after, mp.result, mp.points_won,
              u.username, u.id AS user_id
       FROM match_players mp JOIN users u ON u.id = mp.user_id
       WHERE mp.match_id = $1`,
      [id],
    );
    return { match, players };
  });

  // ---------- matchmaking ----------
  app.post("/api/v1/matchmaking/join", async (req) => {
    const user = await requireAuth(req);
    const body = z
      .object({ mode: z.enum(["ranked", "casual"]).default("ranked") })
      .parse(req.body ?? {});
    const existing = matchManager.getMatchForUser(user.id);
    if (existing && !existing.finished) {
      throw err(409, "Already in a match");
    }
    // queue via websocket conn required; REST returns status
    return { ok: true, mode: body.mode, note: "Connect via WebSocket to queue" };
  });

  app.post("/api/v1/matchmaking/cancel", async (req) => {
    const user = await requireAuth(req);
    matchManager.dequeue(user.id);
    return { ok: true };
  });

  app.get("/api/v1/matchmaking/status", async (req) => {
    const user = await requireAuth(req);
    return matchManager.queueStatus(user.id);
  });

  // ---------- private rooms ----------
  app.post("/api/v1/rooms", async (req) => {
    const user = await requireAuth(req);
    if (!matchManager.userConns.get(user.id)) {
      throw err(400, "WebSocket connection required");
    }
    const room = await matchManager.createRoom({
      userId: user.id,
      username: user.username,
      rating: user.rating,
    });
    return { roomId: room.id, code: room.code };
  });

  app.post("/api/v1/rooms/join", async (req) => {
    const user = await requireAuth(req);
    if (!matchManager.userConns.get(user.id)) {
      throw err(400, "WebSocket connection required");
    }
    const body = z.object({ code: z.string().min(4).max(12) }).parse(req.body);
    const res = await matchManager.joinRoomByCode(
      {
        userId: user.id,
        username: user.username,
        rating: user.rating,
      },
      body.code,
    );
    if (!res.ok) throw err(404, res.error ?? "Cannot join");
    return { roomId: res.room!.id, code: res.room!.code };
  });

  app.post("/api/v1/rooms/:id/start", async (req) => {
    const user = await requireAuth(req);
    const { id } = req.params as { id: string };
    const res = await matchManager.startRoomMatch(id, user.id);
    if (!res.ok) throw err(400, res.error ?? "Cannot start");
    return { matchId: res.match!.id };
  });

  app.post("/api/v1/rooms/leave", async (req) => {
    const user = await requireAuth(req);
    matchManager.leaveRoom(user.id);
    return { ok: true };
  });

  // ---------- leaderboard ----------
  app.get("/api/v1/leaderboard", async (req) => {
    const { rows } = await query(
      `SELECT id, username, rating, wins, losses, avatar
       FROM users
       WHERE deleted_at IS NULL
       ORDER BY rating DESC, wins DESC
       LIMIT 100`,
    );
    return { players: rows };
  });

  // ---------- current live match info ----------
  app.get("/api/v1/me/match", async (req) => {
    const user = await requireAuth(req);
    const m = matchManager.getMatchForUser(user.id);
    if (!m) return { match: null };
    return {
      match: {
        id: m.id,
        phase: m.phase,
        score: m.score,
        mode: m.mode,
        finished: m.finished,
        yourSide: m.playerByUser(user.id)?.side ?? null,
        players: m.players.map((p) => ({
          username: p.username,
          rating: p.rating,
          connected: p.connected,
          side: p.side,
        })),
      },
    };
  });

}
