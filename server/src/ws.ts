import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { getSessionUser } from "./auth.js";
import { matchManager, type ClientConn } from "./game/manager.js";
import { z } from "zod";
import type { PaddleState } from "./game/physics.js";
import { config } from "./config.js";

const paddleSchema = z.object({
  pos: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
  }),
  quat: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  vel: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
  }),
  angVel: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
  }),
  faceRadius: z.number().finite().optional(),
});

const clientMsgSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello") }),
  z.object({ type: z.literal("matchmaking:join"), mode: z.enum(["ranked", "casual"]).default("ranked") }),
  z.object({ type: z.literal("matchmaking:cancel") }),
  z.object({ type: z.literal("match:join"), matchId: z.string().uuid(), spectate: z.boolean().default(false) }),
  z.object({ type: z.literal("input"), seq: z.number().int().nonnegative(), paddle: paddleSchema }),
  z.object({ type: z.literal("serve"), vel: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }) }),
  z.object({ type: z.literal("room:create") }),
  z.object({ type: z.literal("room:join"), code: z.string().min(4).max(12) }),
  z.object({ type: z.literal("room:start"), roomId: z.string().uuid() }),
  z.object({ type: z.literal("room:leave") }),
  z.object({ type: z.literal("ping") }),
]);

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

export async function registerWs(app: FastifyInstance): Promise<void> {
  app.get("/ws", { websocket: true }, async (socket, req) => {
    const ws = socket as unknown as WebSocket;
    const conn: ClientConn = {
      send: (data: string) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
      close: (code?: number, reason?: string) => ws.close(code, reason),
    };

    // Origin validation
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      ws.close(4003, "Forbidden origin");
      return;
    }

    // Auth via session cookie (optional for spectate)
    let user = await getSessionUser(req as never);
    let authed = !!user;

    send(ws, { type: "hello", authed, user: user ? { username: user.username, rating: user.rating } : null });

    if (user) {
      matchManager.registerConn(user.id, conn);
    }

    ws.on("message", (raw: Buffer | string) => {
      void (async () => {
        let msg: unknown;
        try {
          msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
        } catch {
          send(ws, { type: "error", error: "Invalid JSON" });
          return;
        }
        const parsed = clientMsgSchema.safeParse(msg);
        if (!parsed.success) {
          send(ws, { type: "error", error: "Invalid message" });
          return;
        }
        const m = parsed.data;

        // allow hello to (re)auth
        if (m.type === "hello") {
          user = await getSessionUser(req as never);
          authed = !!user;
          if (user) matchManager.registerConn(user.id, conn);
          send(ws, { type: "hello", authed, user: user ? { username: user.username, rating: user.rating } : null });
          return;
        }

        const needAuth = [
          "matchmaking:join",
          "matchmaking:cancel",
          "match:join",
          "input",
          "serve",
          "room:create",
          "room:join",
          "room:start",
          "room:leave",
        ];
        if (needAuth.includes(m.type) && !user) {
          send(ws, { type: "error", error: "Not authenticated" });
          return;
        }

        switch (m.type) {
          case "matchmaking:join": {
            if (!user) return;
            const existing = matchManager.getMatchForUser(user.id);
            if (existing && !existing.finished) {
              send(ws, { type: "error", error: "Already in a match" });
              return;
            }
            matchManager.enqueue({
              userId: user.id,
              username: user.username,
              rating: user.rating,
              mode: m.mode,
              joinedAt: Date.now(),
              ws: conn,
            });
            send(ws, { type: "matchmaking:queued", mode: m.mode });
            break;
          }
          case "matchmaking:cancel": {
            if (user) matchManager.dequeue(user.id);
            send(ws, { type: "matchmaking:cancelled" });
            break;
          }
          case "match:join": {
            const res = matchManager.attachToMatch(
              m.spectate ? null : user?.id ?? null,
              conn,
              m.matchId,
              m.spectate,
            );
            if (!res.ok) send(ws, { type: "error", error: res.error ?? "Cannot join" });
            break;
          }
          case "input": {
            if (!user) return;
            const paddle: PaddleState = {
              pos: m.paddle.pos,
              quat: m.paddle.quat as [number, number, number, number],
              vel: m.paddle.vel,
              angVel: m.paddle.angVel ?? { x: 0, y: 0, z: 0 },
              faceRadius: m.paddle.faceRadius ?? 0.085,
            };
            const r = matchManager.handleInput(user.id, m.seq, paddle);
            if (r !== "ok") send(ws, { type: "input_rejected", reason: r });
            break;
          }
          case "serve": {
            if (!user) return;
            const r = matchManager.handleServe(user.id, m.vel);
            if (r !== "ok") send(ws, { type: "serve_rejected", reason: r });
            break;
          }
          case "room:create": {
            if (!user) return;
            const room = await matchManager.createRoom({
              userId: user.id,
              username: user.username,
              rating: user.rating,
              ws: conn,
            });
            send(ws, { type: "room:created", roomId: room.id, code: room.code });
            break;
          }
          case "room:join": {
            if (!user) return;
            const res = await matchManager.joinRoomByCode(
              { userId: user.id, username: user.username, rating: user.rating, ws: conn },
              m.code,
            );
            if (!res.ok) send(ws, { type: "error", error: res.error ?? "Cannot join" });
            else send(ws, { type: "room:joined", roomId: res.room!.id, code: res.room!.code });
            break;
          }
          case "room:start": {
            if (!user) return;
            const res = await matchManager.startRoomMatch(m.roomId, user.id);
            if (!res.ok) send(ws, { type: "error", error: res.error ?? "Cannot start" });
            break;
          }
          case "room:leave": {
            if (user) matchManager.leaveRoom(user.id);
            send(ws, { type: "room:left" });
            break;
          }
          case "ping": {
            send(ws, { type: "pong", ts: Date.now() });
            break;
          }
        }
      })();
    });

    ws.on("close", () => {
      if (user) matchManager.unregisterConn(user.id, conn);
      else matchManager.removeSpectatorConn(conn);
    });

    ws.on("error", () => {
      if (user) matchManager.unregisterConn(user.id, conn);
    });
  });
}
