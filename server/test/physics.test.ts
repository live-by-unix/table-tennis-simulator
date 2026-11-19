import { describe, it, expect } from "vitest";
import {
  stepBall,
  checkTableCollision,
  checkNetCollision,
  checkPaddleCollision,
  isOutOfBounds,
  validatePaddleState,
  BallState,
  PaddleState,
  TABLE,
  BALL_RADIUS,
  v3,
  len,
} from "../src/game/physics.js";

function ballAt(x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): BallState {
  return { pos: v3(x, y, z), vel: v3(vx, vy, vz), spin: v3() };
}

function paddleAt(x: number, y: number, z: number, facingPosX: number): PaddleState {
  // face normal toward table center-ish: use yaw quaternion
  const angle = facingPosX > x ? Math.PI / 2 : -Math.PI / 2;
  const s = Math.sin(angle / 2), c = Math.cos(angle / 2);
  return {
    pos: v3(x, y, z),
    quat: [0, s, 0, c],
    vel: v3(),
    angVel: v3(),
    faceRadius: 0.085,
  };
}

describe("ball physics", () => {
  it("accelerates downward under gravity", () => {
    const b = ballAt(0, 2, 0, 0, 0, 0);
    const y0 = b.pos.y;
    for (let i = 0; i < 60; i++) stepBall(b, 1 / 60);
    expect(b.pos.y).toBeLessThan(y0 - 3);
    expect(b.vel.y).toBeLessThan(0);
  });

  it("slows horizontal motion via drag", () => {
    const b = ballAt(0, 3, 0, 5, 0, 0);
    for (let i = 0; i < 60; i++) stepBall(b, 1 / 60);
    expect(b.vel.x).toBeLessThan(5);
    expect(b.vel.x).toBeGreaterThan(0);
  });

  it("bounces on the table with restitution", () => {
    const b = ballAt(0.5, TABLE.HEIGHT + 0.5, 0, 0, -3, 0);
    let bounced = false;
    for (let i = 0; i < 120; i++) {
      const prev = { ...b.pos };
      stepBall(b, 1 / 240);
      const hit = checkTableCollision(prev, b);
      if (hit) { bounced = true; expect(hit.side).toBe(1); break; }
    }
    expect(bounced).toBe(true);
    expect(b.vel.y).toBeGreaterThan(0); // moving up after bounce
  });

  it("does not bounce outside table bounds", () => {
    const b = ballAt(5, TABLE.HEIGHT + 0.3, 0, 0, -2, 0);
    let bounced = false;
    for (let i = 0; i < 240; i++) {
      const prev = { ...b.pos };
      stepBall(b, 1 / 240);
      if (checkTableCollision(prev, b)) { bounced = true; break; }
    }
    expect(bounced).toBe(false);
  });

  it("collides with the net", () => {
    const b = ballAt(-0.3, TABLE.HEIGHT + 0.1, 0, 5, 0, 0);
    let netHit = false;
    for (let i = 0; i < 60; i++) {
      const prev = { ...b.pos };
      stepBall(b, 1 / 240);
      if (checkNetCollision(prev, b)) { netHit = true; break; }
    }
    expect(netHit).toBe(true);
    expect(b.vel.x).toBeLessThan(0); // reflected back
  });

  it("paddle hit reverses ball velocity and adds paddle speed", () => {
    const b = ballAt(-1.47, 1.0, 0, -4, 0, 0); // moving toward -x (toward side0 player)
    const p = paddleAt(-1.5, 1.0, 0, 0);
    p.vel = v3(3, 0, 0); // swinging toward table (+x)
    const hit = checkPaddleCollision({ ...b.pos }, b, p, 0);
    expect(hit).not.toBeNull();
    expect(b.vel.x).toBeGreaterThan(0); // now moving back toward table
    expect(len(b.vel)).toBeGreaterThan(4);
  });

  it("paddle hit imparts spin", () => {
    const b = ballAt(-1.47, 1.0, 0, -4, 0, 0);
    const p = paddleAt(-1.5, 1.0, 0, 0);
    p.angVel = v3(0, 0, 30); // brush upward
    checkPaddleCollision({ ...b.pos }, b, p, 0);
    expect(len(b.spin)).toBeGreaterThan(1);
  });

  it("detects out of bounds", () => {
    expect(isOutOfBounds(ballAt(0, -1, 0))).toBe(true);
    expect(isOutOfBounds(ballAt(0, 1, 0))).toBe(false);
  });
});

describe("paddle validation", () => {
  it("accepts sane paddle state", () => {
    const p = paddleAt(-1.5, 1.0, 0, 0);
    expect(validatePaddleState(p)).toBe(true);
  });
  it("rejects teleporting / extreme values", () => {
    const p = paddleAt(-1.5, 1.0, 0, 0);
    p.pos.x = 100;
    expect(validatePaddleState(p)).toBe(false);
  });
  it("rejects non-unit quaternion", () => {
    const p = paddleAt(-1.5, 1.0, 0, 0);
    p.quat = [0, 0, 0, 2];
    expect(validatePaddleState(p)).toBe(false);
  });
  it("rejects excessive velocity", () => {
    const p = paddleAt(-1.5, 1.0, 0, 0);
    p.vel = v3(100, 0, 0);
    expect(validatePaddleState(p)).toBe(false);
  });
});
