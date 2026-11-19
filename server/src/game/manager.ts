import { query } from "../db.js";
import { uuid, roomCode, randomToken, hashToken } from "../util.js";
import { Match, MatchPlayerInit } from "./match.js";
import type { PaddleState, Vec3 } from "./physics.js";
import { persistMatchResult } from "./finish.js";
import { config } from "../config.js";

// ---- WebSocket connection abstraction ----
export interface ClientConn {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface QueueEntry {
  userId: string;
  username: string;
  rating: number;
  mode: "ranked" | "casual";
  joinedAt: number;
  ws: ClientConn;
}

interface RoomPlayer {
  userId: string;
  username: string;
  rating: number;
  ws: ClientConn;
}

interface PrivateRoom {
  id: string;
  code: string;
  hostId: string;
  status: "waiting" | "in_match" | "closed";
  matchId: string | null;
  players: Map<string, RoomPlayer>;
}

const TICK_MS = 1000 / config.gameTickHz;
const SWEEP_MS = 1000;
const MM_WINDOW_BASE = 100;
const MM_WINDOW_GROW = 40; // rating points per second waited
const MM_MAX_WINDOW = 800;

export class MatchManager {
  matches = new Map<string, Match>();
  userMatch = new Map<string, string>(); // userId -> matchId (as player)
  spectators = new Map<string, Set<ClientConn>>(); // matchId -> conns
  spectatorIds = new Map<ClientConn, { matchId: string; specId: string }>();
  userConns = new Map<string, ClientConn>(); // userId -> lobby conn
  queue: QueueEntry[] = [];
  rooms = new Map<string, PrivateRoom>(); // roomId -> room
  roomByCode = new Map<string, string>(); // code -> roomId
  private tickTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  start(): void {
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_MS);
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const m of this.matches.values()) m.finished = true;
  }

  private tick(): void {
    const now = Date.now();
    for (const m of this.matches.values()) {
      m.tick(TICK_MS);
      this.broadcast(m);
      if (m.finished && !m.endedAt) m.endedAt = now;
    }
    // cleanup finished matches after short delay
    for (const [id, m] of this.matches) {
      if (m.finished && m.endedAt && now - m.endedAt > 10000) {
        this.matches.delete(id);
        this.spectators.delete(id);
        for (const p of m.players) this.userMatch.delete(p.userId);
      }
    }
  }

  // ---------- match lifecycle ----------

  async createMatch(
    a: MatchPlayerInit,
    b: MatchPlayerInit,
    mode: "ranked" | "casual" | "private",
  ): Promise<Match> {
    const match = new Match({
      id: uuid(),
      mode,
      players: [
        { userId: a.userId, username: a.username, rating: a.rating },
        { userId: b.userId, username: b.username, rating: b.rating },
      ],
    });
    match.setFinishCallback((m) => persistMatchResult(m));
    this.matches.set(match.id, match);
    this.userMatch.set(a.userId, match.id);
    this.userMatch.set(b.userId, match.id);
    // persist initial match row
    await query(
      `INSERT INTO matches (id, mode, status, server_user_id, client_user_id, score_a, score_b)
       VALUES ($1,$2,'live',$3,$4,0,0)`,
      [match.id, mode, a.userId, b.userId],
    );
    await query(
      `INSERT INTO match_players (match_id, user_id, side, rating_before, points_won)
       VALUES ($1,$2,0,$3,0), ($1,$4,1,$5,0)`,
      [match.id, a.userId, a.rating, b.userId, b.rating],
    );
    return match;
  }

  getMatch(id: string): Match | null {
    return this.matches.get(id) ?? null;
  }

  getMatchForUser(userId: string): Match | null {
    const id = this.userMatch.get(userId);
    return id ? this.matches.get(id) ?? null : null;
  }

  private broadcast(m: Match): void {
    const events = m.drainEvents();
    for (const p of m.players) {
      const conn = this.userConns.get(p.userId);
      if (!conn || !p.connected) continue;
      const msgs = [
        JSON.stringify({ ...m.snapshot(p.side), events }),
      ];
      for (const msg of msgs) {
        try {
          conn.send(msg);
        } catch {
          /* conn dead */
        }
      }
    }
    const specConns = this.spectators.get(m.id);
    if (specConns) {
      for (const conn of specConns) {
        try {
          conn.send(
            JSON.stringify({ ...m.snapshot(null), events, spectator: true }),
          );
        } catch {
          /* dead */
        }
      }
    }
  }

  // ---------- matchmaking ----------

  enqueue(entry: QueueEntry): void {
    this.queue = this.queue.filter((q) => q.userId !== entry.userId);
    this.queue.push(entry);
    void query(
      `INSERT INTO matchmaking_queue (id, user_id, rating, mode)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id) DO UPDATE SET rating = EXCLUDED.rating, joined_at = now(), paired_match_id = NULL`,
      [uuid(), entry.userId, entry.rating, entry.mode],
    ).catch(() => {});
  }

  dequeue(userId: string): void {
    this.queue = this.queue.filter((q) => q.userId !== userId);
    void query(`DELETE FROM matchmaking_queue WHERE user_id = $1`, [
      userId,
    ]).catch(() => {});
  }

  queueStatus(userId: string) {
    const e = this.queue.find((q) => q.userId === userId);
    return e ? { queued: true, mode: e.mode, waitedMs: Date.now() - e.joinedAt } : { queued: false };
  }

  private async sweep(): Promise<void> {
    if (this.queue.length < 2) return;
    const now = Date.now();
    // sort by join time
    this.queue.sort((x, y) => x.joinedAt - y.joinedAt);
    const paired = new Set<string>();
    for (let i = 0; i < this.queue.length; i++) {
      const a = this.queue[i]!;
      if (paired.has(a.userId)) continue;
      const waitA = (now - a.joinedAt) / 1000;
      const window = Math.min(MM_MAX_WINDOW, MM_WINDOW_BASE + MM_WINDOW_GROW * waitA);
      let best: QueueEntry | null = null;
      let bestDiff = Infinity;
      for (let j = i + 1; j < this.queue.length; j++) {
        const b = this.queue[j]!;
        if (paired.has(b.userId)) continue;
        const diff = Math.abs(a.rating - b.rating);
        const waitB = (now - b.joinedAt) / 1000;
        const windowB = Math.min(MM_MAX_WINDOW, MM_WINDOW_BASE + MM_WINDOW_GROW * waitB);
        const effWindow = Math.max(window, windowB);
        if (diff <= effWindow && diff < bestDiff) {
          best = b;
          bestDiff = diff;
        }
      }
      if (best) {
        paired.add(a.userId);
        paired.add(best.userId);
        await this.pairPlayers(a, best);
      }
    }
    this.queue = this.queue.filter((q) => !paired.has(q.userId));
    if (paired.size > 0) {
      await query(
        `DELETE FROM matchmaking_queue WHERE user_id = ANY($1)`,
        [[...paired]],
      ).catch(() => {});
    }
  }

  private async pairPlayers(a: QueueEntry, b: QueueEntry): Promise<void> {
    const match = await this.createMatch(
      { userId: a.userId, username: a.username, rating: a.rating },
      { userId: b.userId, username: b.username, rating: b.rating },
      a.mode === "casual" || b.mode === "casual" ? "casual" : "ranked",
    );
    for (const e of [a, b]) {
      const opp = e === a ? b : a;
      try {
        e.ws.send(
          JSON.stringify({
            type: "matchmaking:found",
            matchId: match.id,
            opponent: { username: opp.username, rating: opp.rating },
          }),
        );
      } catch {
        /* dead */
      }
    }
  }

  // ---------- private rooms ----------

  async createRoom(host: { userId: string; username: string; rating: number; ws: ClientConn }): Promise<PrivateRoom> {
    const id = uuid();
    let code = roomCode();
    // ensure uniqueness
    for (let i = 0; i < 5; i++) {
      const { rows } = await query(`SELECT 1 FROM private_rooms WHERE code = $1`, [code]);
      if (rows.length === 0) break;
      code = roomCode();
    }
    const room: PrivateRoom = {
      id,
      code,
      hostId: host.userId,
      status: "waiting",
      matchId: null,
      players: new Map(),
    };
    room.players.set(host.userId, {
      userId: host.userId,
      username: host.username,
      rating: host.rating,
      ws: host.ws,
    });
    this.rooms.set(id, room);
    this.roomByCode.set(code, id);
    await query(
      `INSERT INTO private_rooms (id, code, host_id, status) VALUES ($1,$2,$3,'waiting')`,
      [id, code, host.userId],
    );
    return room;
  }

  async joinRoomByCode(
    user: { userId: string; username: string; rating: number; ws: ClientConn },
    code: string,
  ): Promise<{ ok: boolean; error?: string; room?: PrivateRoom }> {
    const roomId = this.roomByCode.get(code.toUpperCase());
    if (!roomId) return { ok: false, error: "Room not found" };
    const room = this.rooms.get(roomId);
    if (!room || room.status !== "waiting")
      return { ok: false, error: "Room is not joinable" };
    if (room.players.has(user.userId)) return { ok: true, room };
    if (room.players.size >= 2) return { ok: false, error: "Room is full" };
    room.players.set(user.userId, {
      userId: user.userId,
      username: user.username,
      rating: user.rating,
      ws: user.ws,
    });
    await query(
      `INSERT INTO invitations (id, room_id, inviter_id, invitee_id, token)
       VALUES ($1,$2,$3,$4,$5)`,
      [uuid(), room.id, room.hostId, user.userId, hashToken(randomToken(8))],
    ).catch(() => {});
    // notify host
    const host = room.players.get(room.hostId);
    try {
      host?.ws.send(
        JSON.stringify({
          type: "room:player_joined",
          roomId: room.id,
          code: room.code,
          player: { username: user.username, rating: user.rating },
        }),
      );
    } catch {
      /* dead */
    }
    return { ok: true, room };
  }

  leaveRoom(userId: string): PrivateRoom | null {
    for (const room of this.rooms.values()) {
      if (room.players.has(userId)) {
        room.players.delete(userId);
        if (room.players.size === 0 || userId === room.hostId) {
          room.status = "closed";
          this.rooms.delete(room.id);
          this.roomByCode.delete(room.code);
          void query(`UPDATE private_rooms SET status='closed' WHERE id=$1`, [room.id]).catch(() => {});
        }
        return room;
      }
    }
    return null;
  }

  async startRoomMatch(roomId: string, requesterId: string): Promise<{ ok: boolean; error?: string; match?: Match }> {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: "Room not found" };
    if (room.hostId !== requesterId) return { ok: false, error: "Only host can start" };
    if (room.players.size !== 2) return { ok: false, error: "Need 2 players" };
    const [a, b] = [...room.players.values()];
    if (!a || !b) return { ok: false, error: "Need 2 players" };
    const match = await this.createMatch(
      { userId: a.userId, username: a.username, rating: a.rating },
      { userId: b.userId, username: b.username, rating: b.rating },
      "private",
    );
    room.status = "in_match";
    room.matchId = match.id;
    await query(`UPDATE private_rooms SET status='in_match', match_id=$2 WHERE id=$1`, [
      roomId,
      match.id,
    ]).catch(() => {});
    for (const p of room.players.values()) {
      try {
        p.ws.send(JSON.stringify({ type: "room:match_started", matchId: match.id }));
      } catch {
        /* dead */
      }
    }
    return { ok: true, match };
  }

  // ---------- ws plumbing ----------

  registerConn(userId: string, conn: ClientConn): void {
    this.userConns.set(userId, conn);
  }

  unregisterConn(userId: string, conn: ClientConn): void {
    if (this.userConns.get(userId) === conn) this.userConns.delete(userId);
    // if in a match, mark disconnected
    const matchId = this.userMatch.get(userId);
    if (matchId) {
      const m = this.matches.get(matchId);
      m?.markDisconnected(userId);
    }
    // remove from queue if present
    const q = this.queue.find((e) => e.userId === userId);
    if (q) {
      this.dequeue(userId);
      try {
        q.ws.send(JSON.stringify({ type: "matchmaking:cancelled" }));
      } catch {
        /* dead */
      }
    }
    // leave room
    this.leaveRoom(userId);
    // remove spectating conns
    const spec = this.spectatorIds.get(conn);
    if (spec) {
      this.spectatorIds.delete(conn);
      const set = this.spectators.get(spec.matchId);
      if (set) {
        set.delete(conn);
        if (set.size === 0) this.spectators.delete(spec.matchId);
      }
      this.matches.get(spec.matchId)?.removeSpectator(spec.specId);
    }
  }

  removeSpectatorConn(conn: ClientConn): void {
    const spec = this.spectatorIds.get(conn);
    if (!spec) return;
    this.spectatorIds.delete(conn);
    const set = this.spectators.get(spec.matchId);
    if (set) {
      set.delete(conn);
      if (set.size === 0) this.spectators.delete(spec.matchId);
    }
    this.matches.get(spec.matchId)?.removeSpectator(spec.specId);
  }

  attachToMatch(userId: string | null, conn: ClientConn, matchId: string, spectate: boolean): { ok: boolean; error?: string } {
    const m = this.matches.get(matchId);
    if (!m || m.finished) return { ok: false, error: "Match not found" };
    if (spectate || !userId) {
      const specId = `spec-${Math.random().toString(36).slice(2)}`;
      m.addSpectator(specId);
      this.spectatorIds.set(conn, { matchId, specId });
      let set = this.spectators.get(matchId);
      if (!set) {
        set = new Set();
        this.spectators.set(matchId, set);
      }
      set.add(conn);
      conn.send(JSON.stringify(m.snapshot(null)));
      return { ok: true };
    }
    const p = m.playerByUser(userId);
    if (!p) return { ok: false, error: "Not a player in this match" };
    m.markConnected(userId);
    this.registerConn(userId, conn);
    conn.send(JSON.stringify(m.snapshot(p.side)));
    return { ok: true };
  }

  handleInput(userId: string, seq: number, paddle: PaddleState): string {
    const matchId = this.userMatch.get(userId);
    if (!matchId) return "not_in_match";
    const m = this.matches.get(matchId);
    if (!m) return "not_in_match";
    return m.handlePaddleInput(userId, seq, paddle);
  }

  handleServe(userId: string, vel: Vec3): string {
    const matchId = this.userMatch.get(userId);
    if (!matchId) return "not_in_match";
    const m = this.matches.get(matchId);
    if (!m) return "not_in_match";
    return m.handleServe(userId, vel);
  }
}

export const matchManager = new MatchManager();
