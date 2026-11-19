import { describe, it, expect, beforeAll, afterAll } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

const PORT = 55433;
let pg: InstanceType<typeof EmbeddedPostgres>;
let app: FastifyInstance;

async function inject(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, cookie?: string) {
  return app.inject({
    method,
    url,
    payload: payload as Record<string, unknown> | undefined,
    headers: cookie ? { cookie } : {},
  });
}

function cookieOf(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((c) => c.name === "tts_session");
  return c ? `${c.name}=${c.value}` : "";
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-pg-"));
  pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("tabletennis");
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/tabletennis`;
  process.env.SESSION_SECRET = "test-secret";
  process.env.NODE_ENV = "test";

  const { createApp } = await import("../src/index.js");
  app = await createApp();
}, 120000);

afterAll(async () => {
  await app?.close();
  await pg?.stop();
});

describe("auth API", () => {
  it("health check", async () => {
    const res = await inject("GET", "/api/v1/health");
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("registers a user and sets session cookie", async () => {
    const res = await inject("POST", "/api/v1/auth/register", {
      username: "alice_test",
      password: "password123",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe("alice_test");
    expect(res.json().user.rating).toBe(1200);
    expect(cookieOf(res)).toContain("tts_session=");
  });

  it("rejects duplicate username", async () => {
    const res = await inject("POST", "/api/v1/auth/register", {
      username: "alice_test",
      password: "password123",
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects short password", async () => {
    const res = await inject("POST", "/api/v1/auth/register", {
      username: "bob_test",
      password: "short",
    });
    expect(res.statusCode).toBe(400);
  });

  it("login works and /me returns user", async () => {
    const login = await inject("POST", "/api/v1/auth/login", {
      username: "alice_test",
      password: "password123",
    });
    expect(login.statusCode).toBe(200);
    const cookie = cookieOf(login);
    const me = await inject("GET", "/api/v1/auth/me", undefined, cookie);
    expect(me.json().user.username).toBe("alice_test");
  });

  it("rejects wrong password", async () => {
    const res = await inject("POST", "/api/v1/auth/login", {
      username: "alice_test",
      password: "wrongpassword",
    });
    expect(res.statusCode).toBe(401);
  });

  it("requires auth for profile", async () => {
    const res = await inject("GET", "/api/v1/profile");
    expect(res.statusCode).toBe(401);
  });

  it("logout invalidates session", async () => {
    const login = await inject("POST", "/api/v1/auth/login", {
      username: "alice_test",
      password: "password123",
    });
    const cookie = cookieOf(login);
    await inject("POST", "/api/v1/auth/logout", undefined, cookie);
    const me = await inject("GET", "/api/v1/auth/me", undefined, cookie);
    expect(me.json().user).toBeNull();
  });
});

describe("profile & stats API", () => {
  let cookie: string;
  beforeAll(async () => {
    const res = await inject("POST", "/api/v1/auth/login", {
      username: "alice_test",
      password: "password123",
    });
    cookie = cookieOf(res);
  });

  it("returns own profile", async () => {
    const res = await inject("GET", "/api/v1/profile", undefined, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.username).toBe("alice_test");
    expect(res.json().profile.rating).toBe(1200);
  });

  it("updates avatar", async () => {
    const res = await inject("PATCH", "/api/v1/profile", { avatar: "https://example.com/a.png" }, cookie);
    expect(res.statusCode).toBe(200);
    const p = await inject("GET", "/api/v1/profile", undefined, cookie);
    expect(p.json().profile.avatar).toBe("https://example.com/a.png");
  });

  it("public profile by username", async () => {
    const res = await inject("GET", "/api/v1/profile/alice_test");
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.username).toBe("alice_test");
  });

  it("leaderboard includes user", async () => {
    const res = await inject("GET", "/api/v1/leaderboard");
    expect(res.statusCode).toBe(200);
    expect(res.json().players.length).toBeGreaterThan(0);
  });

  it("match history empty initially", async () => {
    const res = await inject("GET", "/api/v1/matches", undefined, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().matches).toEqual([]);
  });
});

describe("match persistence & Elo", () => {
  it("persists match result and updates ratings", async () => {
    const { matchManager } = await import("../src/game/manager.js");
    const { persistMatchResult } = await import("../src/game/finish.js");
    const { query } = await import("../src/db.js");

    // create second user
    await inject("POST", "/api/v1/auth/register", {
      username: "bob_test",
      password: "password123",
    });
    const { rows } = await query<{ id: string; username: string; rating: number }>(
      "SELECT id, username, rating FROM users WHERE username IN ('alice_test','bob_test')",
    );
    const alice = rows.find((r) => r.username === "alice_test")!;
    const bob = rows.find((r) => r.username === "bob_test")!;

    const match = await matchManager.createMatch(
      { userId: alice.id, username: alice.username, rating: alice.rating },
      { userId: bob.id, username: bob.username, rating: bob.rating },
      "casual",
    );
    // simulate completion: alice wins 11-5
    match.score = [11, 5];
    match.winner = 0;
    match.finished = true;
    match.finishReason = "completed";
    match.endedAt = Date.now();
    match.longestRally = 7;
    await persistMatchResult(match);

    const { rows: after } = await query<{ username: string; rating: number; wins: number; losses: number }>(
      "SELECT username, rating, wins, losses FROM users WHERE username IN ('alice_test','bob_test') ORDER BY username",
    );
    const a = after.find((r) => r.username === "alice_test")!;
    const b = after.find((r) => r.username === "bob_test")!;
    expect(a.rating).toBeGreaterThan(1200);
    expect(b.rating).toBeLessThan(1200);
    expect(a.wins).toBe(1);
    expect(b.losses).toBe(1);

    // match history shows the match
    const login = await inject("POST", "/api/v1/auth/login", {
      username: "alice_test",
      password: "password123",
    });
    const res = await inject("GET", "/api/v1/matches", undefined, cookieOf(login));
    expect(res.json().matches.length).toBe(1);
    expect(res.json().matches[0].status).toBe("finished");

    // match detail
    const mid = res.json().matches[0].id;
    const detail = await inject("GET", `/api/v1/matches/${mid}`, undefined, cookieOf(login));
    expect(detail.statusCode).toBe(200);
    expect(detail.json().players.length).toBe(2);

    // cleanup manager state
    matchManager.matches.delete(match.id);
    matchManager.userMatch.delete(alice.id);
    matchManager.userMatch.delete(bob.id);
  });
});
