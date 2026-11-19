// Shared table-tennis constants (meters) — mirror server physics.
export const TABLE = {
  LENGTH: 2.74,
  WIDTH: 1.525,
  HEIGHT: 0.76,
  THICKNESS: 0.05,
  NET_HEIGHT: 0.1525,
  NET_THICKNESS: 0.015,
} as const;

export const BALL_RADIUS = 0.02;
export const PADDLE_FACE_RADIUS = 0.085;

export interface SnapPaddle {
  side: number;
  username: string;
  rating: number;
  connected: boolean;
  pos: { x: number; y: number; z: number };
  quat: [number, number, number, number];
  vel: { x: number; y: number; z: number };
}

export interface SnapBall {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  spin: { x: number; y: number; z: number };
}

export interface GameSnapshot {
  type: "state";
  matchId: string;
  phase: string;
  score: [number, number];
  serverSide: number;
  servePhase: string;
  pointScore: number;
  deuce: boolean;
  ball: SnapBall | null;
  paddles: SnapPaddle[];
  spectators: number;
  yourSide: 0 | 1 | null;
  winner: number | null;
  finishReason: string;
  events?: unknown[];
  spectator?: boolean;
}
