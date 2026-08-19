import type { FastifyInstance } from "fastify";
import { historyService } from "../services/historyService.js";

export async function historyRoutes(app: FastifyInstance) {
  // GET /api/history?limit=100&offset=0&search=...
  app.get("/api/history", async (req) => {
    const q = req.query as { limit?: string; offset?: string; search?: string };
    const limit = q.limit ? parseInt(q.limit, 10) : 100;
    const offset = q.offset ? parseInt(q.offset, 10) : 0;
    return await historyService.list({ limit, offset, search: q.search });
  });
}
