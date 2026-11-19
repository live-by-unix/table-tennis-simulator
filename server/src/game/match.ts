// Server-authoritative match: physics + official table tennis rules.
import {
  BallState,
  PaddleState,
  TABLE,
  BALL_RADIUS,
  Vec3,
  checkTableCollision,
  checkNetCollision,
  checkPaddleCollision,
  isOutOfBounds,
  stepBall,
  tableSide,
  validatePaddleState,
  v3,
  len,
  norm,
  scale,
  add,
  sub,
  dot,
  paddleNormal,
} from "./physics.js";
import { config } from "../config.js";

export type MatchPhase =
  | "countdown"
  | "serve_ready"
  | "rally"
  | "point_end"
  | "match_end";

export type ServePhase =
  | "none"
  | "need_own_bounce"
  | "need_opp_bounce"
  | "let";

export interface MatchPlayer {
  userId: string;
  username: string;
  rating: number;
  side: 0 | 1;
  connected: boolean;
  disconnectedAt: number | null;
  paddle: PaddleState;
  lastInputSeq: number;
  lastInputAt: number;
}

export interface MatchOptions {
  id: string;
  mode: "ranked" | "casual" | "private";
  players: [MatchPlayerInit, MatchPlayerInit];
  pointScore?: number;
}

export interface MatchPlayerInit {
  userId: string;
  username: string;
  rating: number;
}

export interface PointResult {
  winner: 0 | 1;
  reason: string;
}

const COUNTDOWN_S = 3;
const POINT_PAUSE_S = 1.4;
const SERVE_TIMEOUT_S = 15;
const SUBSTEP = 1 / 240;

function defaultPaddle(side: 0 | 1): PaddleState {
  // Side 0 at x=-1.6 facing +x; side 1 at x=+1.6 facing -x.
  const x = side === 0 ? -1.7 : 1.7;
  // quaternion rotating local +z to world ±x: rotY(∓90°)
  const angle = side === 0 ? Math.PI / 2 : -Math.PI / 2;
  const s = Math.sin(angle / 2);
  const c = Math.cos(angle / 2);
  return {
    pos: { x, y: 1.1, z: 0 },
    quat: [0, s, 0, c],
    vel: v3(),
    angVel: v3(),
    faceRadius: 0.085,
  };
}

export class Match {
  readonly id: string;
  readonly mode: MatchOptions["mode"];
  readonly pointScore: number;
  players: [MatchPlayer, MatchPlayer];
  phase: MatchPhase = "countdown";
  phaseTimer = COUNTDOWN_S;
  score: [number, number] = [0, 0];
  serverSide: 0 | 1 = 0;
  pointsSinceServe = 0;
  servePhase: ServePhase = "none";
  serveTimer = 0;
  letCount = 0;

  ball: BallState = {
    pos: v3(0, 1, 0),
    vel: v3(),
    spin: v3(),
  };
  ballActive = false;

  // rally bookkeeping
  lastHitSide: 0 | 1 | null = null;
  pendingReturner: 0 | 1 | null = null;
  expectFirstBounceSide: 0 | 1 | null = null;
  lastBounceSide: 0 | 1 | null = null;
  consecutiveBounces = 0;
  netTouched = false;
  rallyHits = 0;
  longestRally = 0;

  spectators = new Set<string>();
  elapsedMs = 0;
  finished = false;
  winner: 0 | 1 | null = null;
  finishReason = "";
  startedAt = Date.now();
  endedAt: number | null = null;
  private onFinishCb: ((m: Match) => Promise<void>) | null = null;
  events: unknown[] = [];

  constructor(opts: MatchOptions) {
    this.id = opts.id;
    this.mode = opts.mode;
    this.pointScore = opts.pointScore ?? config.pointScore;
    this.players = [
      this.makePlayer(opts.players[0], 0),
      this.makePlayer(opts.players[1], 1),
    ];
  }

  private makePlayer(init: MatchPlayerInit, side: 0 | 1): MatchPlayer {
    return {
      userId: init.userId,
      username: init.username,
      rating: init.rating,
      side,
      connected: true,
      disconnectedAt: null,
      paddle: defaultPaddle(side),
      lastInputSeq: 0,
      lastInputAt: 0,
    };
  }

  setFinishCallback(cb: (m: Match) => Promise<void>): void {
    this.onFinishCb = cb;
  }

  playerByUser(userId: string): MatchPlayer | null {
    return this.players.find((p) => p.userId === userId) ?? null;
  }

  otherSide(side: 0 | 1): 0 | 1 {
    return side === 0 ? 1 : 0;
  }

  isDeuce(): boolean {
    return this.score[0] >= this.pointScore - 1 && this.score[1] >= this.pointScore - 1;
  }

  // ---------- input handling ----------

  handlePaddleInput(
    userId: string,
    seq: number,
    paddle: PaddleState,
  ): "ok" | "invalid" | "not_player" | "rate_limited" {
    const p = this.playerByUser(userId);
    if (!p) return "not_player";
    if (!p.connected) return "not_player";
    if (seq <= p.lastInputSeq) return "ok"; // stale, ignore silently
    if (!validatePaddleState(paddle)) return "invalid";

    const now = Date.now();
    const dt = Math.max(1, now - p.lastInputAt) / 1000;
    // Sanity: paddle cannot move faster than cap between updates.
    const maxStep = 18 * dt * 2.5 + 0.05;
    const dx = paddle.pos.x - p.paddle.pos.x;
    const dy = paddle.pos.y - p.paddle.pos.y;
    const dz = paddle.pos.z - p.paddle.pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > maxStep) return "rate_limited";

    p.paddle = paddle;
    p.lastInputSeq = seq;
    p.lastInputAt = now;
    return "ok";
  }

  handleServe(userId: string, vel: Vec3): "ok" | "invalid" | "not_server" {
    const p = this.playerByUser(userId);
    if (!p) return "not_server";
    if (p.side !== this.serverSide) return "not_server";
    if (this.phase !== "serve_ready" || this.servePhase !== "need_own_bounce")
      return "invalid";
    const speed = len(vel);
    if (!Number.isFinite(speed) || speed < 2 || speed > 18) return "invalid";
    if (vel.y > 4) return "invalid"; // serve must be directed downward-ish

    // Place ball just in front of server's paddle.
    const n = paddleNormal(p.paddle);
    const center: Vec3 = { x: 0, y: TABLE.HEIGHT, z: 0 };
    const toward = sub(center, p.paddle.pos);
    const nn = dot(n, toward) >= 0 ? n : scale(n, -1);
    this.ball.pos = add(p.paddle.pos, add(scale(nn, 0.12), v3(0, 0.02, 0)));
    this.ball.vel = { ...vel };
    this.ball.spin = v3();
    this.ballActive = true;
    this.servePhase = "need_own_bounce";
    this.phase = "rally";
    this.serveTimer = 0;
    this.lastHitSide = this.serverSide;
    this.pendingReturner = this.otherSide(this.serverSide);
    this.expectFirstBounceSide = null; // serve handled by servePhase
    this.netTouched = false;
    this.rallyHits = 0;
    return "ok";
  }

  // ---------- main tick ----------

  tick(dtMs: number): void {
    if (this.finished) return;
    this.elapsedMs += dtMs;
    const dt = Math.min(dtMs / 1000, 0.1);

    // disconnect grace / forfeit
    this.checkDisconnects();
    if (this.finished) return;

    switch (this.phase) {
      case "countdown":
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.beginServe();
        break;
      case "serve_ready":
        this.serveTimer += dt;
        if (this.serveTimer > SERVE_TIMEOUT_S) {
          // server failed to serve -> point to receiver
          this.awardPoint(this.otherSide(this.serverSide), "serve_timeout");
        }
        // ball rests at paddle; keep it glued lightly
        break;
      case "rally":
        this.stepRally(dt);
        break;
      case "point_end":
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          if (this.checkMatchEnd()) return;
          this.beginServe();
        }
        break;
      case "match_end":
        break;
    }
  }

  private beginServe(): void {
    this.phase = "serve_ready";
    this.servePhase = "need_own_bounce";
    this.serveTimer = 0;
    this.ballActive = false;
    this.ball.vel = v3();
    this.ball.spin = v3();
    this.lastHitSide = null;
    this.pendingReturner = null;
    this.expectFirstBounceSide = null;
    this.lastBounceSide = null;
    this.consecutiveBounces = 0;
    this.netTouched = false;
    this.rallyHits = 0;
    this.letCount = 0;
    // place ball in front of server paddle for visuals
    const srv = this.players[this.serverSide];
    const n = paddleNormal(srv.paddle);
    const center: Vec3 = { x: 0, y: TABLE.HEIGHT, z: 0 };
    const toward = sub(center, srv.paddle.pos);
    const nn = dot(n, toward) >= 0 ? n : scale(n, -1);
    this.ball.pos = add(srv.paddle.pos, add(scale(nn, 0.12), v3(0, 0.05, 0)));
    this.pushEvent({ type: "serve", server: this.serverSide });
  }

  private stepRally(dt: number): void {
    if (!this.ballActive) return;
    const prev = { ...this.ball.pos };

    let remaining = dt;
    while (remaining > 0) {
      const h = Math.min(SUBSTEP, remaining);
      remaining -= h;
      stepBall(this.ball, h);

      // paddle collisions (only the side expected to return, plus server during serve phase)
      const serving =
        this.servePhase === "need_own_bounce" ||
        this.servePhase === "need_opp_bounce";
      for (const p of this.players) {
        if (!p.connected) continue;
        const canHit = serving
          ? p.side === this.serverSide
          : this.pendingReturner === null || p.side === this.pendingReturner;
        if (!canHit) continue;
        const hit = checkPaddleCollision(prev, this.ball, p.paddle, p.side);
        if (hit) {
          this.onPaddleHit(p.side);
          break;
        }
      }

      const bounce = checkTableCollision({ ...prev }, this.ball);
      if (bounce) {
        this.onTableBounce(bounce.side, bounce.pos);
        if (this.finished || this.phase !== "rally") return;
      }

      if (checkNetCollision({ ...prev }, this.ball)) {
        this.netTouched = true;
      }

      if (isOutOfBounds(this.ball)) {
        this.onBallOut();
        return;
      }
    }
  }

  private onPaddleHit(side: 0 | 1): void {
    // During serve, only server may contact before own bounce.
    if (this.servePhase === "need_own_bounce" && side !== this.serverSide) {
      // receiver interfered: replay serve (let)
      this.letCount++;
      this.beginServe();
      return;
    }
    if (
      this.servePhase === "need_opp_bounce" &&
      side !== this.serverSide &&
      this.lastHitSide === this.serverSide
    ) {
      // receiver hit before ball bounced on their side -> let (replay)
      this.letCount++;
      this.beginServe();
      return;
    }

    this.rallyHits++;
    this.longestRally = Math.max(this.longestRally, this.rallyHits);
    this.lastHitSide = side;
    this.pendingReturner = this.otherSide(side);
    // After a hit, ball must first bounce on opponent's side.
    this.expectFirstBounceSide = this.otherSide(side);
    this.lastBounceSide = null;
    this.consecutiveBounces = 0;
    this.netTouched = false;

    // serve progression
    if (this.servePhase === "need_own_bounce" && side === this.serverSide) {
      // server hit before own bounce: that's the serve itself - handled in handleServe.
    }
    this.pushEvent({ type: "hit", side, pos: { ...this.ball.pos } });
  }

  private onTableBounce(side: 0 | 1, pos: Vec3): void {
    this.pushEvent({ type: "bounce", side, pos });

    if (this.phase !== "rally") return;

    // Serve sequence enforcement.
    if (this.servePhase === "need_own_bounce") {
      if (side === this.serverSide) {
        this.servePhase = "need_opp_bounce";
        this.expectFirstBounceSide = this.otherSide(this.serverSide);
        this.lastBounceSide = side;
        this.consecutiveBounces = 1;
        this.pendingReturner = this.otherSide(this.serverSide);
        return;
      }
      // bounced on wrong side first -> service fault
      this.awardPoint(this.otherSide(this.serverSide), "service_fault");
      return;
    }
    if (this.servePhase === "need_opp_bounce") {
      if (side === this.otherSide(this.serverSide)) {
        // legal serve completed -> rally
        this.servePhase = "none";
        this.lastHitSide = this.serverSide;
        this.pendingReturner = this.otherSide(this.serverSide);
        this.expectFirstBounceSide = null;
        this.lastBounceSide = side;
        this.consecutiveBounces = 1;
        return;
      }
      // second bounce also on server side or net earlier -> fault
      this.awardPoint(this.otherSide(this.serverSide), "service_fault");
      return;
    }

    // Rally bounce logic.
    if (this.expectFirstBounceSide !== null) {
      if (side === this.expectFirstBounceSide) {
        // legal first bounce on opponent's side
        this.expectFirstBounceSide = null;
        this.pendingReturner = side;
        this.lastBounceSide = side;
        this.consecutiveBounces = 1;
      } else {
        // bounced back on hitter's side without net -> hitter loses
        if (!this.netTouched && this.lastHitSide !== null) {
          this.awardPoint(this.otherSide(this.lastHitSide), "shot_not_crossing");
        } else {
          // net cord onto own side: live, side must return
          this.expectFirstBounceSide = null;
          this.pendingReturner = side;
          this.lastBounceSide = side;
          this.consecutiveBounces = 1;
        }
      }
      return;
    }

    // Subsequent bounce: double bounce check.
    if (this.lastBounceSide === side) {
      // ball bounced twice on same side -> side that failed to return loses
      this.awardPoint(this.otherSide(side), "double_bounce");
      return;
    }
    this.lastBounceSide = side;
    this.consecutiveBounces++;
    this.pendingReturner = side;
  }

  private onBallOut(): void {
    if (this.phase !== "rally") return;
    if (this.servePhase === "need_own_bounce" || this.servePhase === "need_opp_bounce") {
      this.awardPoint(this.otherSide(this.serverSide), "service_fault");
      return;
    }
    // Point to the side that was not expected to return / did not hit last.
    const loser = this.pendingReturner ?? this.otherSide(this.lastHitSide ?? this.serverSide);
    const winner = this.otherSide(loser);
    this.awardPoint(winner, "ball_out");
  }

  private awardPoint(winner: 0 | 1, reason: string): void {
    if (this.phase === "point_end" || this.phase === "match_end") return;
    this.score[winner]++;
    this.phase = "point_end";
    this.phaseTimer = POINT_PAUSE_S;
    this.ballActive = false;
    this.servePhase = "none";
    this.pushEvent({ type: "point", winner, reason, score: [...this.score] });

    // serve rotation: every 2 points, or every point at deuce
    const deuce = this.score[0] >= this.pointScore - 1 && this.score[1] >= this.pointScore - 1;
    this.pointsSinceServe++;
    const rotateEvery = deuce ? 1 : 2;
    if (this.pointsSinceServe >= rotateEvery) {
      this.serverSide = this.otherSide(this.serverSide);
      this.pointsSinceServe = 0;
    }
  }

  private checkMatchEnd(): boolean {
    const [a, b] = this.score;
    const target = this.pointScore;
    if ((a >= target || b >= target) && Math.abs(a - b) >= 2) {
      this.phase = "match_end";
      this.winner = a > b ? 0 : 1;
      this.finished = true;
      this.endedAt = Date.now();
      this.finishReason = "completed";
      this.pushEvent({
        type: "match_end",
        winner: this.winner,
        score: [...this.score],
      });
      if (this.onFinishCb) {
        void this.onFinishCb(this).catch((e) =>
          console.error("finish callback error", e),
        );
      }
      return true;
    }
    return false;
  }

  private checkDisconnects(): void {
    for (const p of this.players) {
      if (!p.connected && p.disconnectedAt !== null) {
        if (this.elapsedMs - p.disconnectedAt > config.disconnectGraceMs) {
          // forfeit
          const winner = this.otherSide(p.side);
          this.phase = "match_end";
          this.winner = winner;
          this.finished = true;
          this.endedAt = Date.now();
          this.finishReason = "abandoned";
          this.pushEvent({
            type: "match_end",
            winner,
            score: [...this.score],
            reason: "abandoned",
          });
          if (this.onFinishCb) {
            void this.onFinishCb(this).catch((e) =>
              console.error("finish callback error", e),
            );
          }
          return;
        }
      }
    }
  }

  markDisconnected(userId: string): void {
    const p = this.playerByUser(userId);
    if (p) {
      p.connected = false;
      p.disconnectedAt = this.elapsedMs;
    }
  }

  markConnected(userId: string): void {
    const p = this.playerByUser(userId);
    if (p) {
      p.connected = true;
      p.disconnectedAt = null;
    }
  }

  addSpectator(id: string): void {
    this.spectators.add(id);
  }
  removeSpectator(id: string): void {
    this.spectators.delete(id);
  }

  private pushEvent(ev: unknown): void {
    this.events.push(ev);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  drainEvents(): unknown[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  snapshot(yourSide: 0 | 1 | null) {
    return {
      type: "state" as const,
      matchId: this.id,
      phase: this.phase,
      score: [...this.score] as [number, number],
      serverSide: this.serverSide,
      servePhase: this.servePhase,
      pointScore: this.pointScore,
      deuce: this.isDeuce(),
      ball: this.ballActive
        ? {
            pos: this.ball.pos,
            vel: this.ball.vel,
            spin: this.ball.spin,
          }
        : null,
      paddles: this.players.map((p) => ({
        side: p.side,
        username: p.username,
        rating: p.rating,
        connected: p.connected,
        pos: p.paddle.pos,
        quat: p.paddle.quat,
        vel: p.paddle.vel,
      })),
      spectators: this.spectators.size,
      yourSide,
      winner: this.winner,
      finishReason: this.finishReason,
    };
  }
}
