import type { FastifyInstance } from "fastify";
import { queueService } from "../services/queueService.js";
import { displayService } from "../services/displayService.js";
import { AppError, toErrorResponse } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export function createCallsRoutes(deps: {
  onCallPerson: (personId: number, displayId?: string | null) => Promise<void>;
  onReplay: (displayId?: string | null) => Promise<void>;
}) {
  return async function callsRoutes(app: FastifyInstance) {
    // POST /api/calls { personId, displayId? }
    app.post("/api/calls", async (req, reply) => {
      try {
        const body = (req.body || {}) as { personId?: number; displayId?: string };
        const personId = Number(body.personId);
        if (!Number.isFinite(personId)) {
          throw new AppError("INVALID_INPUT", "personId الزامی است", 400);
        }
        await deps.onCallPerson(personId, body.displayId ?? null);
        reply.code(202);
        return { ok: true };
      } catch (e) {
        const err = toErrorResponse(e);
        reply.code(
          err.code === "NOT_FOUND" ? 404 :
          err.code === "DUPLICATE_CALL" ? 409 :
          err.code === "INACTIVE_PERSON" ? 400 :
          400,
        );
        return err;
      }
    });

    // POST /api/calls/replay { displayId? }
    app.post("/api/calls/replay", async (req, reply) => {
      try {
        const body = (req.body || {}) as { displayId?: string };
        await deps.onReplay(body.displayId ?? null);
        reply.code(202);
        return { ok: true };
      } catch (e) {
        const err = toErrorResponse(e);
        reply.code(400);
        return err;
      }
    });
  };
}

export async function queueRoutes(app: FastifyInstance) {
  // GET /api/queue
  app.get("/api/queue", async () => {
    return await queueService.snapshot();
  });

  // DELETE /api/queue/:id (delete item entirely)
  app.delete("/api/queue/:id", async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    await queueService.delete(id);
    reply.code(204);
    return null;
  });

  // POST /api/queue/:id/cancel
  app.post("/api/queue/:id/cancel", async (req) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    return await queueService.cancel(id);
  });

  // POST /api/queue/:id/skip
  app.post("/api/queue/:id/skip", async (req) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    return await queueService.skip(id);
  });

  // POST /api/queue/clear
  app.post("/api/queue/clear", async (req, reply) => {
    try {
      const body = (req.body || {}) as { includePlaying?: boolean };
      const result = body.includePlaying
        ? await queueService.clearAll()
        : await queueService.clearWaiting();
      reply.code(200);
      return result;
    } catch (e) {
      logger.error("Clear queue failed", { error: (e as Error).message });
      reply.code(500);
      return { code: "CLEAR_FAILED", message: "پاک کردن صف ناموفق بود" };
    }
  });
}

export async function displaysRoutes(app: FastifyInstance) {
  // GET /api/displays
  app.get("/api/displays", async () => {
    return await displayService.list();
  });
}
