import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";
import { registerWs } from "./ws.js";
import { runMigrations } from "./migrate.js";
import { matchManager } from "./game/manager.js";
import { closeDb } from "./db.js";

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: 64 * 1024,
  });

  await app.register(cors, {
    origin: config.allowedOrigins,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(websocket);

  // Serve built client in production (single-origin deployment)
  const clientDist = new URL("../../client/dist", import.meta.url).pathname;
  const { existsSync } = await import("node:fs");
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        reply.status(404).send({ error: "Not found" });
      } else {
        reply.sendFile("index.html");
      }
    });
  }

  const applied = await runMigrations();
  if (applied.length) {
    app.log.info({ applied }, "Applied database migrations");
  }

  await registerRoutes(app);
  await registerWs(app);

  app.setErrorHandler((err: unknown, req, reply) => {
    const e = err as { statusCode?: number; message?: string; name?: string };
    if (e.name === "ZodError") {
      reply.status(400).send({ error: "Invalid request body" });
      return;
    }
    const status = e.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    reply.status(status).send({
      error: status >= 500 ? "Internal server error" : (e.message ?? "Error"),
    });
  });

  return app;
}

async function main(): Promise<void> {
  const app = await createApp();
  matchManager.start();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down");
    matchManager.stop();
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`Server listening on http://0.0.0.0:${config.port}`);
}

const isMain = process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts");
if (isMain) {
  main().catch((err) => {
    console.error("Fatal startup error:", err);
    process.exit(1);
  });
}
