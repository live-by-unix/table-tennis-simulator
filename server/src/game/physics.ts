// Server-authoritative table tennis physics.
// Units: meters, seconds, radians. Coordinate system:
//   x: along table length (player A at x<0, player B at x>0)
//   y: up (table surface at y=0 local, world y = TABLE_HEIGHT)
//   z: across table width

export const TABLE = {
  LENGTH: 2.74, // x extent
  WIDTH: 1.525, // z extent
  HEIGHT: 0.76, // top surface y
  NET_HEIGHT: 0.1525, // above table surface
  NET_THICKNESS: 0.015,
  NET_HALF_WIDTH: 0.914, // slightly wider than table? actually equals half width + posts
} as const;

export const BALL_RADIUS = 0.02;
export const BALL_MASS = 0.0027;

const GRAVITY = 9.81;
// Quadratic drag coefficient: tuned so terminal velocity ~9.5 m/s for a 40mm ball.
const DRAG_K = 0.115;
// Magnus coefficient: spin produces lateral/vertical acceleration.
const MAGNUS_K = 0.0016;
const SPIN_DECAY = 0.35; // exponential decay rate of spin (1/s)

const RESTITUTION_TABLE = 0.9;
const RESTITUTION_PADDLE = 0.85;
const TABLE_FRICTION = 0.35;
const SPIN_BOUNCE = 0.012; // how much spin kicks the ball on table bounce

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}
export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function len(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}
export function norm(a: Vec3): Vec3 {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 0, z: 0 } : scale(a, 1 / l);
}
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  spin: Vec3; // angular velocity rad/s
}

export interface PaddleState {
  pos: Vec3; // center of paddle face
  quat: [number, number, number, number]; // orientation; local +z = face normal toward table
  vel: Vec3; // linear velocity of paddle center
  angVel: Vec3; // angular velocity (world space, rad/s)
  faceRadius: number;
}

export const PADDLE_FACE_RADIUS = 0.085;
export const PADDLE_MAX_SPEED = 18; // m/s validation cap
export const PADDLE_PLAY_BOUNDS = {
  xMin: -2.4,
  xMax: 2.4,
  yMin: 0.1,
  yMax: 2.4,
  zMin: -1.4,
  zMax: 1.4,
};

// Quaternion helpers (x,y,z,w)
export function quatRotate(q: [number, number, number, number], v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  return {
    x: v.x + qw * tx + qy * tz - qz * ty,
    y: v.y + qw * ty + qz * tx - qx * tz,
    z: v.z + qw * tz + qx * ty - qy * tx,
  };
}

export function paddleNormal(p: PaddleState): Vec3 {
  // local +z axis rotated by quaternion
  return quatRotate(p.quat, { x: 0, y: 0, z: 1 });
}

export interface StepEvents {
  tableBounce?: { side: 0 | 1; pos: Vec3 };
  netHit?: boolean;
  paddleHit?: { side: 0 | 1; pos: Vec3 };
  outOfBounds?: boolean;
}

function netTopY(): number {
  return TABLE.HEIGHT + TABLE.NET_HEIGHT;
}
function tableTopY(): number {
  return TABLE.HEIGHT;
}

function inTableX(x: number): boolean {
  return Math.abs(x) <= TABLE.LENGTH / 2;
}
function inTableZ(z: number): boolean {
  return Math.abs(z) <= TABLE.WIDTH / 2;
}

// Integrate one substep of ball physics. dt in seconds.
export function stepBall(ball: BallState, dt: number): void {
  // gravity
  ball.vel.y -= GRAVITY * dt;

  // quadratic drag
  const speed = len(ball.vel);
  if (speed > 1e-6) {
    const dragAcc = DRAG_K * speed;
    ball.vel.x -= ball.vel.x * dragAcc * dt;
    ball.vel.y -= ball.vel.y * dragAcc * dt;
    ball.vel.z -= ball.vel.z * dragAcc * dt;
  }

  // Magnus effect: a = k * (spin x velocity)
  const magnus = cross(ball.spin, ball.vel);
  ball.vel.x += magnus.x * MAGNUS_K * dt;
  ball.vel.y += magnus.y * MAGNUS_K * dt;
  ball.vel.z += magnus.z * MAGNUS_K * dt;

  // spin decay
  const decay = Math.exp(-SPIN_DECAY * dt);
  ball.spin.x *= decay;
  ball.spin.y *= decay;
  ball.spin.z *= decay;

  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;
  ball.pos.z += ball.vel.z * dt;
}

// Check & resolve table bounce. Returns bounce info or null.
// side: 0 = x<0 half, 1 = x>0 half (net plane x=0).
export function checkTableCollision(
  prev: Vec3,
  ball: BallState,
): { side: 0 | 1; pos: Vec3 } | null {
  const top = tableTopY();
  const r = BALL_RADIUS;
  // Did the ball cross the table surface plane this step while over the table?
  if (prev.y - r >= top && ball.pos.y - r < top && ball.vel.y < 0) {
    if (inTableX(ball.pos.x) && inTableZ(ball.pos.z)) {
      // refine bounce position linearly
      const t = (prev.y - r - top) / (prev.y - ball.pos.y);
      const bx = prev.x + (ball.pos.x - prev.x) * t;
      const bz = prev.z + (ball.pos.z - prev.z) * t;
      if (inTableX(bx) && inTableZ(bz)) {
        ball.pos.y = top + r;
        // restitution + friction + spin kick
        ball.vel.y = -ball.vel.y * RESTITUTION_TABLE;
        const spinKickX = -ball.spin.z * SPIN_BOUNCE * 60;
        const spinKickZ = ball.spin.x * SPIN_BOUNCE * 60;
        ball.vel.x = ball.vel.x * (1 - TABLE_FRICTION) + spinKickX * TABLE_FRICTION * 8;
        ball.vel.z = ball.vel.z * (1 - TABLE_FRICTION) + spinKickZ * TABLE_FRICTION * 8;
        // damp spin on bounce
        ball.spin.x *= 0.7;
        ball.spin.z *= 0.7;
        const side: 0 | 1 = ball.pos.x < 0 ? 0 : 1;
        return { side, pos: { x: bx, y: top, z: bz } };
      }
    }
    // landed outside table -> check edge: if close to edge treat as out (handled by caller via outOfBounds)
  }
  return null;
}

// Net collision: net is a thin vertical plane at x=0 spanning z in [-W/2, W/2], y in [top, top+netH].
export function checkNetCollision(prev: Vec3, ball: BallState): boolean {
  const top = tableTopY();
  const netY0 = top;
  const netY1 = netTopY();
  const halfThick = TABLE.NET_THICKNESS / 2 + BALL_RADIUS;
  const r = BALL_RADIUS;

  // crossing x=0 plane within net region
  if ((prev.x - 0) * (ball.pos.x - 0) < 0 || Math.abs(ball.pos.x) < halfThick) {
    const t = prev.x !== ball.pos.x ? (0 - prev.x) / (ball.pos.x - prev.x) : 0;
    if (t >= 0 && t <= 1) {
      const iy = prev.y + (ball.pos.y - prev.y) * t;
      const iz = prev.z + (ball.pos.z - prev.z) * t;
      if (iy > netY0 - r && iy < netY1 + r && Math.abs(iz) < TABLE.WIDTH / 2 + 0.05) {
        // reflect x velocity with damping
        ball.pos.x = prev.x < 0 ? -halfThick : halfThick;
        ball.vel.x = -ball.vel.x * 0.25;
        ball.vel.y *= 0.6;
        ball.vel.z *= 0.6;
        ball.spin.x *= 0.5;
        ball.spin.z *= 0.5;
        return true;
      }
    }
  }
  // also check ball already overlapping net box
  if (
    Math.abs(ball.pos.x) < halfThick &&
    ball.pos.y > netY0 - r &&
    ball.pos.y < netY1 + r &&
    Math.abs(ball.pos.z) < TABLE.WIDTH / 2 + 0.05
  ) {
    ball.vel.x = -ball.vel.x * 0.25;
    ball.vel.y *= 0.6;
    ball.vel.z *= 0.6;
    return true;
  }
  return false;
}

// Paddle collision: ball vs oriented paddle face (a disc of faceRadius centered at pos,
// plane normal = paddleNormal, oriented toward the table). Returns hit info or null.
export function checkPaddleCollision(
  prev: Vec3,
  ball: BallState,
  paddle: PaddleState,
  side: 0 | 1,
): { pos: Vec3 } | null {
  void prev;
  const rawN = paddleNormal(paddle);
  // Orient normal toward table center so "front" is consistent for both sides.
  const tableCenter: Vec3 = { x: 0, y: TABLE.HEIGHT, z: 0 };
  const towardCenter = sub(tableCenter, paddle.pos);
  const n = dot(rawN, towardCenter) >= 0 ? rawN : scale(rawN, -1);

  const toBall = sub(ball.pos, paddle.pos);
  const distN = dot(toBall, n);
  const r = BALL_RADIUS;
  if (Math.abs(distN) > r + 0.015) return null;

  // Contact point velocity: linear + angular contribution.
  const offset = sub(ball.pos, paddle.pos);
  const contactVel = add(paddle.vel, cross(paddle.angVel, offset));

  const vRel = sub(ball.vel, contactVel);
  const vn = dot(vRel, n);
  // Approaching = moving against the normal (toward the paddle face).
  if (vn >= 0) return null;

  // Lateral check: ball center projected onto paddle plane must be within face radius.
  const closest = add(paddle.pos, scale(n, distN));
  const lateral = sub(ball.pos, closest);
  if (len(lateral) > paddle.faceRadius) return null;

  const e = RESTITUTION_PADDLE;
  const vRelN = scale(n, vn);
  const vRelT = sub(vRel, vRelN);
  const outVel = add(contactVel, add(scale(n, -e * vn), scale(vRelT, 0.45)));
  ball.vel = outVel;

  // Extra pace from a fast swing along the normal.
  const swingN = dot(contactVel, n);
  if (swingN > 0) {
    ball.vel = add(ball.vel, scale(n, swingN * 0.35));
  }

  // Clamp speeds for sanity.
  const MAX_BALL_SPEED = 35;
  if (len(ball.vel) > MAX_BALL_SPEED) {
    ball.vel = scale(norm(ball.vel), MAX_BALL_SPEED);
  }
  if (len(ball.vel) < 0.5) ball.vel = scale(norm(ball.vel), 0.5);

  // Spin transfer: paddle angular velocity plus tangential contact velocity.
  const tangentialVel = cross(paddle.angVel, offset);
  const spinKick = {
    x: paddle.angVel.x * 0.5 + tangentialVel.x * 1.5,
    y: paddle.angVel.y * 0.4 + tangentialVel.y * 1.0,
    z: paddle.angVel.z * 0.5 + tangentialVel.z * 1.5,
  };
  // Mirror z-spin for the side facing -x so topspin feels consistent.
  const mirror = side === 1 ? -1 : 1;
  ball.spin = {
    x: ball.spin.x * 0.3 + spinKick.x * 0.5,
    y: ball.spin.y * 0.3 + spinKick.y * 0.3,
    z: ball.spin.z * 0.3 + spinKick.z * 0.5 * mirror,
  };
  const spinLen = len(ball.spin);
  const MAX_SPIN = 220; // rad/s
  if (spinLen > MAX_SPIN) ball.spin = scale(norm(ball.spin), MAX_SPIN);

  // Push ball out of the paddle along the normal.
  ball.pos = add(ball.pos, scale(n, Math.sign(distN || 1) * (r + 0.005)));

  return { pos: { ...ball.pos } };
}

// Determine which table half a position belongs to: 0 => x<0, 1 => x>0.
export function tableSide(x: number): 0 | 1 {
  return x < 0 ? 0 : 1;
}

// Ball is out of bounds if below floor level or outside reasonable arena.
export function isOutOfBounds(ball: BallState): boolean {
  return (
    ball.pos.y < -0.5 ||
    Math.abs(ball.pos.x) > 6 ||
    Math.abs(ball.pos.z) > 6
  );
}

// Validate incoming paddle state from a client.
export function validatePaddleState(p: PaddleState): boolean {
  const b = PADDLE_PLAY_BOUNDS;
  if (
    !Number.isFinite(p.pos.x) ||
    !Number.isFinite(p.pos.y) ||
    !Number.isFinite(p.pos.z) ||
    p.pos.x < b.xMin ||
    p.pos.x > b.xMax ||
    p.pos.y < b.yMin ||
    p.pos.y > b.yMax ||
    p.pos.z < b.zMin ||
    p.pos.z > b.zMax
  )
    return false;
  if (!Number.isFinite(p.faceRadius) || p.faceRadius <= 0 || p.faceRadius > 0.2)
    return false;
  const q = p.quat;
  const qlen = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  if (!Number.isFinite(qlen) || Math.abs(qlen - 1) > 0.01) return false;
  const v = len(p.vel);
  if (!Number.isFinite(v) || v > PADDLE_MAX_SPEED) return false;
  const av = len(p.angVel);
  if (!Number.isFinite(av) || av > 60) return false;
  return true;
}
