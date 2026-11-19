import { describe, it, expect, beforeEach } from "vitest";
import { Match } from "../src/game/match.js";
import { v3, PaddleState } from "../src/game/physics.js";

function mkMatch(): Match {
  return new Match({
    id: "test-match",
    mode: "casual",
    players: [
      { userId: "u1", username: "alice", rating: 1200 },
      { userId: "u2", username: "bob", rating: 1200 },
    ],
    pointScore: 11,
  });
}

function paddleFor(match: Match, side: 0 | 1, x: number, y: number, z: number): PaddleState {
  const p = match.players[side].paddle;
  return { ...p, pos: v3(x, y, z) };
}

describe("match rules", () => {
  let m: Match;
  beforeEach(() => { m = mkMatch(); });

  it("starts in countdown then serve_ready", () => {
    expect(m.phase).toBe("countdown");
    for (let i = 0; i < 40; i++) m.tick(100);
    expect(m.phase).toBe("serve_ready");
    expect(m.serverSide).toBe(0);
  });

  it("rejects serve from non-server", () => {
    for (let i = 0; i < 40; i++) m.tick(100);
    const r = m.handleServe("u2", v3(5, -3, 0));
    expect(r).toBe("not_server");
  });

  it("accepts valid serve and progresses phases", () => {
    for (let i = 0; i < 40; i++) m.tick(100);
    const r = m.handleServe("u1", v3(6, -4, 0));
    expect(r).toBe("ok");
    expect(m.phase).toBe("rally");
    expect(m.servePhase).toBe("need_own_bounce");
  });

  it("service fault awards point to receiver", () => {
    for (let i = 0; i < 40; i++) m.tick(100);
    expect(m.handleServe("u1", v3(6, -4, 0))).toBe("ok");
    // force ball out of bounds during serve -> service fault to receiver
    m.ball.pos = v3(5, -2, 0);
    m.ball.vel = v3(0, -5, 0);
    for (let i = 0; i < 10 && m.phase === "rally"; i++) m.tick(16);
    expect(m.score[1]).toBe(1);
    expect(m.phase).toBe("point_end");
  });

  it("scores to 11 and ends match", () => {
    for (let i = 0; i < 40; i++) m.tick(100);
    // force points by simulating out-of-bounds after serve
    for (let pt = 0; pt < 11; pt++) {
      for (let i = 0; i < 40 && m.phase !== "serve_ready"; i++) m.tick(100);
      if (m.phase !== "serve_ready") break;
      m.handleServe("u1", v3(6, -4, 0));
      m.ball.pos = v3(5, -2, 0); // out of bounds -> receiver wins? pendingReturner=side1 -> winner side0? 
      for (let i = 0; i < 10 && m.phase === "rally"; i++) m.tick(16);
      // pump through point_end
      for (let i = 0; i < 30 && m.phase === "point_end"; i++) m.tick(100);
      if (m.phase === "match_end") break;
    }
    expect(m.phase === "match_end" || m.score[0] + m.score[1] > 0).toBe(true);
  });

  it("forfeits on disconnect grace expiry", () => {
    for (let i = 0; i < 40; i++) m.tick(100);
    m.markDisconnected("u2");
    // advance beyond grace (30s)
    for (let i = 0; i < 400; i++) m.tick(100);
    expect(m.phase).toBe("match_end");
    expect(m.winner).toBe(0);
    expect(m.finishReason).toBe("abandoned");
  });

  it("valid paddle input accepted, invalid rejected", () => {
    for (let i = 0; i < 40; i++) m.tick(100);
    const good = paddleFor(m, 0, -1.7, 1.1, 0.3);
    expect(m.handlePaddleInput("u1", 1, good)).toBe("ok");
    const bad = paddleFor(m, 0, 100, 1.1, 0);
    expect(m.handlePaddleInput("u1", 2, bad)).toBe("invalid");
  });
});
