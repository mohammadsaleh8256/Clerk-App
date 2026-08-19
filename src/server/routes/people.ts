import type { FastifyInstance } from "fastify";
import { personService } from "../services/personService.js";
import { AppError, toErrorResponse } from "../utils/errors.js";
import { config } from "../config/index.js";

export async function peopleRoutes(app: FastifyInstance) {
  // GET /api/people?includeInactive=true
  app.get("/api/people", async (req) => {
    const includeInactive = (req.query as { includeInactive?: string }).includeInactive === "true";
    return await personService.list(includeInactive);
  });

  // POST /api/people
  app.post("/api/people", async (req, reply) => {
    try {
      const body = req.body as { number?: number; name?: string; active?: boolean };
      const person = await personService.create({
        number: body.number as number,
        name: body.name as string,
        active: body.active,
      });
      reply.code(201);
      return person;
    } catch (e) {
      const err = toErrorResponse(e);
      reply.code(err.code === "NOT_FOUND" ? 404 : err.code === "DUPLICATE_NUMBER" ? 409 : 400);
      return err;
    }
  });

  // GET /api/people/:id
  app.get("/api/people/:id", async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    const person = await personService.get(id);
    if (!person) {
      reply.code(404);
      return { code: "NOT_FOUND", message: "شخص پیدا نشد" };
    }
    return person;
  });

  // PUT /api/people/:id
  app.put("/api/people/:id", async (req, reply) => {
    try {
      const id = parseInt((req.params as { id: string }).id, 10);
      const body = req.body as { number?: number; name?: string; active?: boolean };
      const person = await personService.update(id, body);
      return person;
    } catch (e) {
      const err = toErrorResponse(e);
      reply.code(err.code === "NOT_FOUND" ? 404 : err.code === "DUPLICATE_NUMBER" ? 409 : 400);
      return err;
    }
  });

  // DELETE /api/people/:id
  app.delete("/api/people/:id", async (req, reply) => {
    try {
      const id = parseInt((req.params as { id: string }).id, 10);
      await personService.delete(id);
      reply.code(204);
      return null;
    } catch (e) {
      const err = toErrorResponse(e);
      reply.code(err.code === "NOT_FOUND" ? 404 : 400);
      return err;
    }
  });

  // POST /api/people/:id/audio — multipart upload
  app.post("/api/people/:id/audio", async (req, reply) => {
    try {
      const id = parseInt((req.params as { id: string }).id, 10);
      const data = await req.file();
      if (!data) {
        throw new AppError("NO_FILE", "فایلی ارسال نشده است", 400);
      }
      // Read into buffer (we already enforce MAX_AUDIO_SIZE at Fastify body limit)
      const chunks: Buffer[] = [];
      let totalSize = 0;
      for await (const chunk of data.file) {
        totalSize += chunk.length;
        if (totalSize > config.maxAudioSize) {
          throw new AppError(
            "FILE_TOO_LARGE",
            `حداکثر حجم فایل ${Math.floor(config.maxAudioSize / 1024 / 1024)} مگابایت است`,
            413,
          );
        }
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      const person = await personService.uploadAudio(id, {
        name: data.filename,
        type: data.mimetype,
        data: buffer,
      });
      return person;
    } catch (e) {
      const err = toErrorResponse(e);
      reply.code(err.code === "NOT_FOUND" ? 404 : err.code === "FILE_TOO_LARGE" ? 413 : err.code === "INVALID_FILE_TYPE" ? 415 : 400);
      return err;
    }
  });

  // DELETE /api/people/:id/audio
  app.delete("/api/people/:id/audio", async (req, reply) => {
    try {
      const id = parseInt((req.params as { id: string }).id, 10);
      const person = await personService.deleteAudio(id);
      return person;
    } catch (e) {
      const err = toErrorResponse(e);
      reply.code(err.code === "NOT_FOUND" ? 404 : 400);
      return err;
    }
  });
}
