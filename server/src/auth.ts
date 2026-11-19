import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import { query, withTransaction } from "./db.js";
import { config } from "./config.js";
import { hashToken, randomToken, uuid } from "./util.js";
import { STARTING_RATING } from "./elo.js";

export interface SessionUser {
  id: string;
  username: string;
  rating: number;
  avatar: string | null;
  wins: number;
  losses: number;
}

const SESSION_COOKIE = "tts_session";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function createUser(
  username: string,
  password: string,
): Promise<SessionUser> {
  const passwordHash = await hashPassword(password);
  const id = uuid();
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO users (id, username, password_hash, rating, wins, losses)
       VALUES ($1, $2, $3, $4, 0, 0)`,
      [id, username, passwordHash, STARTING_RATING],
    );
    await client.query(
      `INSERT INTO player_profiles (user_id, username, rating)
       VALUES ($1, $2, $3)`,
      [id, username, STARTING_RATING],
    );
    await client.query(
      `INSERT INTO player_statistics (user_id) VALUES ($1)`,
      [id],
    );
    await client.query(
      `INSERT INTO player_ratings (user_id, rating, matches_played) VALUES ($1, $2, 0)`,
      [id, STARTING_RATING],
    );
  });
  return {
    id,
    username,
    rating: STARTING_RATING,
    avatar: null,
    wins: 0,
    losses: 0,
  };
}

export async function createSession(
  userId: string,
  req: FastifyRequest,
): Promise<string> {
  const token = randomToken(32);
  const tokenHash = hashToken(token);
  const ttlMs = config.sessionTtlHours * 3600 * 1000;
  await query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval, $5, $6)`,
    [
      uuid(),
      userId,
      tokenHash,
      String(ttlMs),
      req.ip,
      req.headers["user-agent"] ?? null,
    ],
  );
  return token;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    maxAge: config.sessionTtlHours * 3600,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function getSessionUser(
  req: FastifyRequest,
): Promise<SessionUser | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const { rows } = await query<{
    id: string;
    username: string;
    rating: number;
    avatar: string | null;
    wins: number;
    losses: number;
    deleted: boolean;
  }>(
    `SELECT u.id, u.username, u.rating, u.avatar, u.wins, u.losses, (u.deleted_at IS NOT NULL) AS deleted
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()
     LIMIT 1`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row || row.deleted) return null;
  return {
    id: row.id,
    username: row.username,
    rating: row.rating,
    avatar: row.avatar,
    wins: row.wins,
    losses: row.losses,
  };
}

export async function destroySession(req: FastifyRequest): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return;
  await query(`DELETE FROM sessions WHERE token_hash = $1`, [
    hashToken(token),
  ]);
}

export async function destroyAllSessions(userId: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

export async function requireAuth(req: FastifyRequest): Promise<SessionUser> {
  const user = await getSessionUser(req);
  if (!user) {
    const err = new Error("Unauthorized") as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }
  return user;
}

export function publicUser(u: SessionUser) {
  return {
    id: u.id,
    username: u.username,
    rating: u.rating,
    avatar: u.avatar,
    wins: u.wins,
    losses: u.losses,
  };
}

export { SESSION_COOKIE };
