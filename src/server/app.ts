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
 * This handles several scenarios:
 * 1. Fresh project — db/custom.db doesn't exist yet, or exists but is empty.
 * 2. Recovered from git — user cloned the repo but forgot to run `npm run db:setup`.
 * 3. Corrupted database — file exists but is malformed or missing tables.
 *
 * Without this, the server would crash on the first query because Prisma
 * can run raw SQL but tables aren't there.
 */
async function ensureDatabaseSchema(): Promise<void> {
  // Try up to 3 times:
  //   attempt 1: quick check + db push if missing
  //   attempt 2: if still broken AND file looks corrupted, delete it and re-push
  //   attempt 3: final retry
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Try to query a single Person row to check if the table exists.
      await prisma.person.findFirst({ select: { id: true }, take: 1 });
      if (attempt === 1) {
        logger.info("Database schema OK");
      } else {
        logger.info("Database schema OK after recovery");
      }
      return;
    } catch (e: any) {
      const errCode = e?.code || "";
      const errMsg = e?.message || "";
      const isMissingTable = errCode === "P2021" || /does not exist/i.test(errMsg);
      // SQLite error 26 = "file is not a database" (corrupted file)
      // SQLite error 14 = "unable to open database file"
      const isCorrupted = /file is not a database|not a database|extended_code: 26/i.test(errMsg);

      if (!isMissingTable && attempt === 1) {
        // Some other error on first attempt — log it but try the push anyway
        logger.warn("Unexpected database error during schema check", {
          code: errCode,
          message: errMsg.slice(0, 200),
        });
      }

      if (attempt < 3) {
        // If the database file looks corrupted, delete it before retrying.
        // (prisma db push can't repair a non-SQLite file.)
        if (isCorrupted) {
          const dbPath = config.databaseUrl.replace(/^file:/, "");
          logger.warn(`Database file appears corrupted — deleting and recreating: ${dbPath}`);
          try {
            await prisma.$disconnect();
          } catch {
            // ignore
          }
          try {
            if (fs.existsSync(dbPath)) {
              fs.unlinkSync(dbPath);
            }
            // Also delete the -journal and -wal files if they exist
            for (const ext of ["-journal", "-wal", "-shm"]) {
              if (fs.existsSync(dbPath + ext)) {
                fs.unlinkSync(dbPath + ext);
              }
            }
          } catch (delErr) {
            logger.error("Failed to delete corrupted database file", {
              error: (delErr as Error).message,
            });
          }
          try {
            await prisma.$connect();
          } catch {
            // ignore — will reconnect after push
          }
        }

        logger.warn(`Database schema issue (attempt ${attempt}/3) — running prisma db push...`, {
          code: errCode,
        });
        try {
          // Run prisma db push to create tables.
          execSync("npx prisma db push --skip-generate --accept-data-loss", {
            stdio: "pipe",  // capture output to log it
            cwd: config.projectRoot,
            env: { ...process.env, DATABASE_URL: config.databaseUrl },
          });
          logger.info("prisma db push completed — retrying schema check");
          // Disconnect and reconnect to refresh Prisma's connection
          await prisma.$disconnect();
          await prisma.$connect();
        } catch (pushErr: any) {
          logger.error("prisma db push failed", {
            error: pushErr.message,
            stdout: pushErr.stdout?.toString?.() || "",
            stderr: pushErr.stderr?.toString?.() || "",
          });
          // On last attempt, throw a meaningful error
          if (attempt === 3) {
            throw new Error(
              `Database schema could not be created (attempt ${attempt}/3). ` +
              `Please run 'npm run db:setup' manually. ` +
              `Error: ${pushErr.message}`,
            );
          }
        }
      } else {
        // Final attempt failed
        throw new Error(
          `Database schema check failed after 3 attempts. ` +
          `Last error: ${errMsg.slice(0, 200)}. ` +
          `Please delete the db/ folder and run 'npm run db:setup' again.`,
        );
      }
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

  // 9b. Global error handler — catches any unhandled errors from routes and
  // returns a structured 500 response with the error message. Without this,
  // Fastify returns a generic 500 with no body, which makes debugging very hard.
  app.setErrorHandler((error, req, reply) => {
    const url = req.url;
    const method = req.method;
    logger.error("Unhandled route error", {
      method,
      url,
      error: error.message,
      stack: error.stack,
    });
    // Don't leak internal stack traces to the client in production
    const isDev = config.nodeEnv !== "production";
    reply.code(error.statusCode || 500);
    return {
      code: "INTERNAL_ERROR",
      message: error.message || "خطای داخلی سرور",
      ...(isDev ? { stack: error.stack, url, method } : {}),
    };
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
