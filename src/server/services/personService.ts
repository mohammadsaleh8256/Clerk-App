import { prisma } from "./prisma.js";
import { config } from "../config/index.js";
import { deleteAudioFile, saveAudioFile } from "../storage/audioStorage.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { PersonDto } from "@shared/websocket-types/index.js";

function toDto(p: {
  id: number;
  number: number;
  name: string;
  audioFile: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): PersonDto {
  return {
    id: p.id,
    number: p.number,
    name: p.name,
    audioFile: p.audioFile,
    audioUrl: p.audioFile ? `/uploads/audio/${p.audioFile}` : null,
    hasAudio: !!p.audioFile,
    active: p.active,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export const personService = {
  async list(includeInactive = false): Promise<PersonDto[]> {
    const persons = await prisma.person.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: [{ number: "asc" }],
    });
    return persons.map(toDto);
  },

  async listAll(): Promise<PersonDto[]> {
    return this.list(true);
  },

  async get(id: number): Promise<PersonDto | null> {
    const p = await prisma.person.findUnique({ where: { id } });
    return p ? toDto(p) : null;
  },

  async create(input: { number: number; name: string; active?: boolean }): Promise<PersonDto> {
    if (!input.name || typeof input.name !== "string" || input.name.trim().length === 0) {
      throw new AppError("INVALID_INPUT", "نام اجباری است", 400);
    }
    if (!Number.isInteger(input.number) || input.number < 1) {
      throw new AppError("INVALID_INPUT", "شماره باید یک عدد صحیح مثبت باشد", 400);
    }
    try {
      const p = await prisma.person.create({
        data: {
          number: input.number,
          name: input.name.trim(),
          active: input.active ?? true,
        },
      });
      logger.info("Person created", { id: p.id, number: p.number });
      return toDto(p);
    } catch (e: any) {
      if (e?.code === "P2002") {
        throw new AppError("DUPLICATE_NUMBER", "این شماره قبلاً ثبت شده است", 409);
      }
      throw e;
    }
  },

  async update(
    id: number,
    input: { number?: number; name?: string; active?: boolean },
  ): Promise<PersonDto> {
    const existing = await prisma.person.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError("NOT_FOUND", "شخص پیدا نشد", 404);
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      if (typeof input.name !== "string" || input.name.trim().length === 0) {
        throw new AppError("INVALID_INPUT", "نام نمی‌تواند خالی باشد", 400);
      }
      data.name = input.name.trim();
    }
    if (input.number !== undefined) {
      if (!Number.isInteger(input.number) || input.number < 1) {
        throw new AppError("INVALID_INPUT", "شماره نامعتبر است", 400);
      }
      data.number = input.number;
    }
    if (input.active !== undefined) {
      data.active = !!input.active;
    }

    try {
      const p = await prisma.person.update({ where: { id }, data });
      logger.info("Person updated", { id: p.id });
      return toDto(p);
    } catch (e: any) {
      if (e?.code === "P2002") {
        throw new AppError("DUPLICATE_NUMBER", "این شماره قبلاً ثبت شده است", 409);
      }
      throw e;
    }
  },

  async delete(id: number): Promise<void> {
    const existing = await prisma.person.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError("NOT_FOUND", "شخص پیدا نشد", 404);
    }
    // Remove audio file (with cascade delete on queue items & history via Prisma)
    if (existing.audioFile) {
      deleteAudioFile(existing.audioFile);
    }
    await prisma.person.delete({ where: { id } });
    logger.info("Person deleted", { id });
  },

  async uploadAudio(
    id: number,
    file: { name: string; type?: string; data: Buffer },
  ): Promise<PersonDto> {
    const existing = await prisma.person.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError("NOT_FOUND", "شخص پیدا نشد", 404);
    }

    const stored = saveAudioFile({
      originalName: file.name,
      mime: file.type,
      buffer: file.data,
      previousRelativePath: existing.audioFile,
    });

    const updated = await prisma.person.update({
      where: { id },
      data: { audioFile: stored.relativePath },
    });
    logger.info("Audio uploaded for person", { personId: id, file: stored.relativePath });
    return toDto(updated);
  },

  async deleteAudio(id: number): Promise<PersonDto> {
    const existing = await prisma.person.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError("NOT_FOUND", "شخص پیدا نشد", 404);
    }
    if (existing.audioFile) {
      deleteAudioFile(existing.audioFile);
    }
    const updated = await prisma.person.update({
      where: { id },
      data: { audioFile: null },
    });
    logger.info("Audio removed for person", { personId: id });
    return toDto(updated);
  },

  // Background cleanup of orphan audio files (files on disk that no Person references).
  // Called at startup. Returns count of removed files.
  async cleanupOrphanAudio(): Promise<number> {
    const allPersons = await prisma.person.findMany({ select: { audioFile: true } });
    const referenced = new Set(
      allPersons.map((p) => p.audioFile).filter(Boolean) as string[],
    );

    const fs = await import("node:fs");
    const path = await import("node:path");
    let removed = 0;
    if (fs.existsSync(config.uploadsDir)) {
      const entries = fs.readdirSync(config.uploadsDir);
      for (const entry of entries) {
        const full = path.join(config.uploadsDir, entry);
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        const ext = path.extname(entry).toLowerCase();
        if (!config.allowedAudioExtensions.includes(ext)) continue;
        if (!referenced.has(entry)) {
          try {
            fs.unlinkSync(full);
            removed++;
          } catch {
            // ignore
          }
        }
      }
    }
    if (removed > 0) {
      logger.info("Cleaned up orphan audio files", { count: removed });
    }
    return removed;
  },
};
