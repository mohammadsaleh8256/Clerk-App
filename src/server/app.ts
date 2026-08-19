import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { prisma } from "./services/prisma.js";
import { personService } from "./services/personService.js";
import { queueService } from "./services/queueService.js";
import { WsServer } from "./websocket/server.js";
import { createWsHandler } from "./websocket/handler.js";
import { peopleRoutes } from "./routes/people.js";
import { createCallsRoutes, queueRoutes, displaysRoutes } from "./routes/queue.js";
import { historyRoutes } from "./routes/history.js";
import { resolveAudioPath } from "./storage/audioStorage.js";
import { AppError } from "./utils/errors.js";

/**
 * Checks if the database schema is initialized (i.e. the Person table exists).
 * If not, runs `prisma db push` automatically to create tables.
 *
 * This handles two cases:
 * 1. Fresh project — db/custom.db doesn't exist yet, or exists but is empty.
 * 2. Recovered from git — user cloned the repo but forgot to run `npm run db:setup`.
 *
 * Without this, the server would crash on the first query because Prisma
 * can run raw SQL but tables aren't there.
 */
async function ensureDatabaseSchema(): Promise<void> {
  try {
    // Try to query a single Person row to check if the table exists.
    await prisma.person.findFirst({ select: { id: true }, take: 1 });
    logger.info("Database schema OK");
    return;
  } catch (e: any) {
    // P2021: "The table `main.Person` does not exist in the current database"
    // P1: SQLite generic error (table doesn't exist)
    if (e?.code === "P2021" || /does not exist/i.test(e?.message || "")) {
      logger.warn("Database schema missing — running prisma db push to create tables...");
      try {
        // Run prisma db push to create tables.
        // We use execSync because Prisma's programmatic API for migrations
        // is complex and the CLI is reliable.
        execSync("npx prisma db push --skip-generate --accept-data-loss", {
          stdio: "inherit",
          cwd: config.projectRoot,
          env: { ...process.env, DATABASE_URL: config.databaseUrl },
        });
        logger.info("Database schema created successfully");
      } catch (pushErr) {
        logger.error("Failed to create database schema", {
          error: (pushErr as Error).message,
        });
        throw new Error(
          "Database schema could not be created. Please run `npm run db:setup` manually.",
        );
      }
    } else {
      // Some other error — rethrow
      throw e;
    }
  }
}

async function bootstrap() {
  // 1. Database
  await prisma.$connect();
  logger.info("Database connected", { url: config.databaseUrl });

  // 1b. Ensure schema exists (auto-create tables if missing)
  await ensureDatabaseSchema();

  // 2. Recover queue state on startup
  await queueService.recoverOnStartup();

  // 3. Cleanup orphan audio files
  await personService.cleanupOrphanAudio();

  // 4. Create HTTP server (we need access to 'upgrade' events for WebSocket)
  const httpServer = http.createServer();

  // 5. Fastify app — give it the httpServer so it can attach its request handler
  const app = Fastify({
    serverFactory: (handler) => {
      httpServer.on("request", handler);
      return httpServer;
    },
    logger: false,
    bodyLimit: config.maxAudioSize + 1024 * 1024,
  });

  // 6. Multipart for audio uploads
  await app.register(multipart, {
    limits: {
      fileSize: config.maxAudioSize,
      files: 1,
    },
  });

  // 7. Create WebSocket server (lazy deps will be wired next)
  const wsServer = new WsServer(httpServer);
  const handler = createWsHandler(wsServer);
  wsServer.setDeps(handler.deps);

  // 8. CORS not needed (LAN, same origin)

  // 9. REST API routes
  await app.register(async (api) => {
    await peopleRoutes(api);
    await api.register(
      createCallsRoutes({
        onCallPerson: async (personId: number, displayId?: string | null) => {
          await handler.callPerson(personId, displayId);
        },
        onReplay: async (displayId?: string | null) => {
          const item = await handler.replayLast(displayId);
          if (!item) {
            throw new AppError("NOTHING_TO_REPLAY", "هیچ فراخوانی قبلی برای تکرار وجود ندارد", 404);
          }
        },
      }),
    );
    await queueRoutes(api);
    await displaysRoutes(api);
    await historyRoutes(api);

    // Serve audio files (/uploads/audio/...)
    api.get("/uploads/audio/:filename", async (req, reply) => {
      const filename = (req.params as { filename: string }).filename;
      try {
        const abs = resolveAudioPath(filename);
        if (!fs.existsSync(abs)) {
          reply.code(404);
          return { code: "NOT_FOUND", message: "فایل پیدا نشد" };
        }
        const ext = path.extname(abs).toLowerCase();
        const mime = config.audioExtToMime[ext] || "application/octet-stream";
        const stat = fs.statSync(abs);
        reply.header("Content-Type", mime);
        reply.header("Content-Length", stat.size);
        reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
        reply.header("Accept-Ranges", "bytes");
        const stream = fs.createReadStream(abs);
        return reply.send(stream);
      } catch {
        reply.code(403);
        return { code: "FORBIDDEN", message: "دسترسی غیرمجاز" };
      }
    });

    api.get("/api/health", async () => ({ ok: true, ts: Date.now() }));
  });

  // 10. Serve built client (admin + display)
  if (fs.existsSync(config.clientDistDir)) {
    await app.register(fastifyStatic, {
      root: config.clientDistDir,
      prefix: "/",
      wildcard: false,
    });

    app.setNotFoundHandler(async (req, reply) => {
      const url = req.url;
      if (url === "/" || url === "") {
        reply.redirect("/admin");
        return;
      }
      if (url.startsWith("/admin")) {
        return reply.sendFile("admin/index.html");
      }
      if (url.startsWith("/display")) {
        return reply.sendFile("display/index.html");
      }
      reply.code(404);
      return { code: "NOT_FOUND", message: "صفحه پیدا نشد" };
    });
  } else {
    logger.warn("Client dist directory not found; client will not be served in production mode");
  }

  // 11. Start listening
  await app.ready();
  await app.listen({ port: config.port, host: config.host });
  logger.info("Server started", { host: config.host, port: config.port });
  logger.info(`Admin URL:    http://<laptop-ip>:${config.port}/admin`);
  logger.info(`Display URL:  http://<laptop-ip>:${config.port}/display`);
  logger.info(`WebSocket URL: ws://<laptop-ip>:${config.port}/ws`);

  // 12. Try to dispatch any recovered WAITING items to currently-connected displays.
  // (Displays typically connect after server startup, in which case onRegister will dispatch.)
  setTimeout(() => {
    handler.dispatchNextCall().catch((e) => {
      logger.error("Initial dispatch failed", { error: (e as Error).message });
    });
  }, 1000);

  // 13. Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}; shutting down...`);
    try {
      await app.close();
      await prisma.$disconnect();
      logger.info("Server stopped cleanly");
      process.exit(0);
    } catch (e) {
      logger.error("Error during shutdown", { error: (e as Error).message });
      process.exit(1);
    }
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (e) => {
    logger.error("Uncaught exception", { error: e.message, stack: e.stack });
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", { reason: reason as any });
  });
}

bootstrap().catch((e) => {
  logger.error("Bootstrap failed", { error: e.message, stack: e.stack });
  process.exit(1);
});
