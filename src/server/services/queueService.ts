import { prisma } from "./prisma.js";
import { config } from "../config/index.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { QueueItemDto, QueueItemStatus } from "@shared/websocket-types/index.js";

function toDto(q: {
  id: number;
  personId: number;
  number: number;
  name: string;
  audioFile: string | null;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  displayId: string | null;
}): QueueItemDto {
  return {
    id: q.id,
    personId: q.personId,
    number: q.number,
    name: q.name,
    audioFile: q.audioFile,
    audioUrl: q.audioFile ? `/uploads/audio/${q.audioFile}` : null,
    status: q.status as QueueItemStatus,
    createdAt: q.createdAt.toISOString(),
    startedAt: q.startedAt ? q.startedAt.toISOString() : null,
    completedAt: q.completedAt ? q.completedAt.toISOString() : null,
    displayId: q.displayId,
  };
}

export interface QueueSnapshot {
  current: QueueItemDto | null;
  waiting: QueueItemDto[];
}

// In-memory status of which QueueItem each display is currently playing.
// Maps displayId -> queueItemId
const displayPlaying = new Map<string, number>();

export const queueService = {
  /**
   * Returns the next WAITING item, ordered by createdAt ascending.
   */
  async _nextWaiting(): Promise<QueueItemDto | null> {
    const next = await prisma.queueItem.findFirst({
      where: { status: "WAITING" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return next ? toDto(next) : null;
  },

  async snapshot(): Promise<QueueSnapshot> {
    const [playing, waiting] = await Promise.all([
      prisma.queueItem.findFirst({
        where: { status: "PLAYING" },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      }),
      prisma.queueItem.findMany({
        where: { status: "WAITING" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    return {
      current: playing ? toDto(playing) : null,
      waiting: waiting.map(toDto),
    };
  },

  /**
   * Add a person to the queue. Checks for duplicates depending on config.
   */
  async enqueue(opts: {
    personId: number;
    displayId?: string | null;
  }): Promise<{ item: QueueItemDto; duplicated: boolean }> {
    const person = await prisma.person.findUnique({
      where: { id: opts.personId },
    });
    if (!person) {
      throw new AppError("NOT_FOUND", "شخص پیدا نشد", 404);
    }
    if (!person.active) {
      throw new AppError("INACTIVE_PERSON", "این شخص غیرفعال است", 400);
    }

    // Check for duplicates
    const existingWaiting = await prisma.queueItem.findFirst({
      where: { personId: person.id, status: "WAITING" },
    });
    const existingPlaying = await prisma.queueItem.findFirst({
      where: { personId: person.id, status: "PLAYING" },
    });

    if ((existingWaiting || existingPlaying) && !config.duplicateAllowed) {
      // Reject duplicate
      throw new AppError(
        "DUPLICATE_CALL",
        "این شخص در حال حاضر در صف انتظار است یا در حال پخش است",
        409,
        {
          existingWaitingId: existingWaiting?.id,
          existingPlayingId: existingPlaying?.id,
        },
      );
    }

    const item = await prisma.queueItem.create({
      data: {
        personId: person.id,
        number: person.number,
        name: person.name,
        audioFile: person.audioFile,
        status: "WAITING",
        displayId: opts.displayId || null,
      },
    });

    logger.info("Person enqueued", {
      queueItemId: item.id,
      personId: person.id,
      number: person.number,
    });

    return { item: toDto(item), duplicated: !!(existingWaiting || existingPlaying) };
  },

  /**
   * Mark a QueueItem as PLAYING.
   */
  async start(queueItemId: number, displayId?: string): Promise<QueueItemDto> {
    const item = await prisma.queueItem.findUnique({ where: { id: queueItemId } });
    if (!item) {
      throw new AppError("NOT_FOUND", "آیتم صف پیدا نشد", 404);
    }
    if (item.status !== "WAITING" && item.status !== "PLAYING") {
      throw new AppError(
        "INVALID_STATUS",
        `این آیتم در وضعیت ${item.status} است و نمی‌تواند شروع شود`,
        400,
      );
    }
    const updated = await prisma.queueItem.update({
      where: { id: queueItemId },
      data: {
        status: "PLAYING",
        startedAt: new Date(),
        displayId: displayId || item.displayId,
      },
    });
    if (displayId) {
      displayPlaying.set(displayId, queueItemId);
    }
    logger.info("Queue item started", { queueItemId, displayId });
    return toDto(updated);
  },

  /**
   * Mark a QueueItem as COMPLETED.
   */
  async complete(queueItemId: number): Promise<QueueItemDto | null> {
    const item = await prisma.queueItem.findUnique({ where: { id: queueItemId } });
    if (!item) return null;
    if (item.status === "COMPLETED" || item.status === "CANCELLED" || item.status === "FAILED") {
      return toDto(item);
    }
    const updated = await prisma.queueItem.update({
      where: { id: queueItemId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    // Write to history
    await prisma.callHistory.create({
      data: {
        personId: item.personId,
        number: item.number,
        name: item.name,
        audioFile: item.audioFile,
        status: "COMPLETED",
        calledAt: item.createdAt,
        completedAt: updated.completedAt,
        displayId: updated.displayId,
      },
    });

    // Clear display playing
    if (updated.displayId) {
      const cur = displayPlaying.get(updated.displayId);
      if (cur === queueItemId) {
        displayPlaying.delete(updated.displayId);
      }
    }

    logger.info("Queue item completed", { queueItemId });
    return toDto(updated);
  },

  /**
   * Mark a QueueItem as FAILED.
   */
  async fail(queueItemId: number, _reason?: string): Promise<QueueItemDto | null> {
    const item = await prisma.queueItem.findUnique({ where: { id: queueItemId } });
    if (!item) return null;
    if (item.status === "COMPLETED" || item.status === "CANCELLED" || item.status === "FAILED") {
      return toDto(item);
    }
    const updated = await prisma.queueItem.update({
      where: { id: queueItemId },
      data: { status: "FAILED", completedAt: new Date() },
    });

    await prisma.callHistory.create({
      data: {
        personId: item.personId,
        number: item.number,
        name: item.name,
        audioFile: item.audioFile,
        status: "FAILED",
        calledAt: item.createdAt,
        completedAt: updated.completedAt,
        displayId: updated.displayId,
      },
    });

    if (updated.displayId) {
      const cur = displayPlaying.get(updated.displayId);
      if (cur === queueItemId) {
        displayPlaying.delete(updated.displayId);
      }
    }

    logger.warn("Queue item failed", { queueItemId, reason: _reason });
    return toDto(updated);
  },

  /**
   * Cancel a QueueItem. Allowed from WAITING or PLAYING.
   */
  async cancel(queueItemId: number): Promise<QueueItemDto | null> {
    const item = await prisma.queueItem.findUnique({ where: { id: queueItemId } });
    if (!item) return null;
    if (item.status === "COMPLETED" || item.status === "CANCELLED" || item.status === "FAILED") {
      return toDto(item);
    }
    const wasPlaying = item.status === "PLAYING";
    const updated = await prisma.queueItem.update({
      where: { id: queueItemId },
      data: { status: "CANCELLED", completedAt: new Date() },
    });

    await prisma.callHistory.create({
      data: {
        personId: item.personId,
        number: item.number,
        name: item.name,
        audioFile: item.audioFile,
        status: "CANCELLED",
        calledAt: item.createdAt,
        completedAt: updated.completedAt,
        displayId: updated.displayId,
      },
    });

    if (wasPlaying && updated.displayId) {
      const cur = displayPlaying.get(updated.displayId);
      if (cur === queueItemId) {
        displayPlaying.delete(updated.displayId);
      }
    }

    logger.info("Queue item cancelled", { queueItemId });
    return toDto(updated);
  },

  /**
   * Skip the current item: mark as COMPLETED (without history entry) so next can proceed.
   * Skip is also applied on the playing item.
   */
  async skip(queueItemId: number): Promise<QueueItemDto | null> {
    const item = await prisma.queueItem.findUnique({ where: { id: queueItemId } });
    if (!item) return null;
    if (item.status === "COMPLETED" || item.status === "CANCELLED" || item.status === "FAILED") {
      return toDto(item);
    }
    const updated = await prisma.queueItem.update({
      where: { id: queueItemId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    // Skip does NOT write to history (it's a forced advance, not a real call completion).
    // But we DO record history if it was playing (since it actually started).
    if (item.status === "PLAYING") {
      await prisma.callHistory.create({
        data: {
          personId: item.personId,
          number: item.number,
          name: item.name,
          audioFile: item.audioFile,
          status: "COMPLETED",
          calledAt: item.createdAt,
          completedAt: updated.completedAt,
          displayId: updated.displayId,
        },
      });
    }

    if (updated.displayId) {
      const cur = displayPlaying.get(updated.displayId);
      if (cur === queueItemId) {
        displayPlaying.delete(updated.displayId);
      }
    }

    logger.info("Queue item skipped", { queueItemId });
    return toDto(updated);
  },

  /**
   * Delete a queue item entirely (no history record).
   */
  async delete(queueItemId: number): Promise<void> {
    const item = await prisma.queueItem.findUnique({ where: { id: queueItemId } });
    if (!item) return;

    if (item.status === "PLAYING") {
      // We do allow deletion of playing item but log a warning
      logger.warn("Deleting a PLAYING queue item", { queueItemId });
      if (item.displayId) {
        const cur = displayPlaying.get(item.displayId);
        if (cur === queueItemId) {
          displayPlaying.delete(item.displayId);
        }
      }
    }

    await prisma.queueItem.delete({ where: { id: queueItemId } });
    logger.info("Queue item deleted", { queueItemId });
  },

  /**
   * Clear all WAITING items. Does NOT touch the playing one.
   */
  async clearWaiting(): Promise<{ count: number }> {
    const result = await prisma.queueItem.deleteMany({
      where: { status: "WAITING" },
    });
    logger.info("Queue cleared", { count: result.count });
    return { count: result.count };
  },

  /**
   * Cancel the currently-playing item AND clear the waiting queue.
   */
  async clearAll(): Promise<{ cancelled: number; cleared: number }> {
    const playing = await prisma.queueItem.findFirst({
      where: { status: "PLAYING" },
    });
    let cancelled = 0;
    if (playing) {
      await this.cancel(playing.id);
      cancelled = 1;
    }
    const cleared = await this.clearWaiting();
    return { cancelled, cleared: cleared.count };
  },

  /**
   * Replay: take the most recently completed call and re-enqueue it.
   * Returns the new QueueItem, or null if nothing to replay.
   */
  async replay(displayId?: string | null): Promise<QueueItemDto | null> {
    // Find the latest completed/failed/cancelled item
    const last = await prisma.queueItem.findFirst({
      where: {
        status: { in: ["COMPLETED", "FAILED", "CANCELLED"] },
      },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    });
    if (!last) {
      return null;
    }
    // Find the person (still need to ensure person exists)
    const person = await prisma.person.findUnique({
      where: { id: last.personId },
    });
    if (!person) {
      // person was deleted; can't replay
      return null;
    }
    const item = await prisma.queueItem.create({
      data: {
        personId: person.id,
        number: person.number,
        name: person.name,
        audioFile: person.audioFile,
        status: "WAITING",
        displayId: displayId || null,
      },
    });
    logger.info("Replay enqueued", {
      newQueueItemId: item.id,
      sourceQueueItemId: last.id,
      personId: person.id,
    });
    return toDto(item);
  },

  /**
   * Called on server startup. Recovers queue state:
   * - WAITING items stay WAITING (will be picked up by Display)
   * - PLAYING items whose display is offline get moved back to WAITING
   *   (we cannot know whether the playback finished)
   * - PLAYING items: revert to WAITING for safety
   */
  async recoverOnStartup(): Promise<{ restoredToWaiting: number }> {
    const playing = await prisma.queueItem.findMany({ where: { status: "PLAYING" } });
    let restoredToWaiting = 0;
    for (const item of playing) {
      await prisma.queueItem.update({
        where: { id: item.id },
        data: { status: "WAITING", startedAt: null, displayId: null },
      });
      restoredToWaiting++;
    }
    displayPlaying.clear();
    if (restoredToWaiting > 0) {
      logger.info("Queue recovery: restored PLAYING items to WAITING", { count: restoredToWaiting });
    }
    return { restoredToWaiting };
  },
};
