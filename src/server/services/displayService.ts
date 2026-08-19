import { prisma } from "./prisma.js";
import { logger } from "../utils/logger.js";
import type { DisplayInfo } from "@shared/websocket-types/index.js";

// Map of currently-connected displays (online)
const onlineDisplays = new Set<string>();

function toDto(d: {
  id: string;
  name: string | null;
  lastSeenAt: Date;
  createdAt: Date;
}): DisplayInfo {
  return {
    id: d.id,
    name: d.name,
    connected: onlineDisplays.has(d.id),
    lastSeenAt: d.lastSeenAt.toISOString(),
  };
}

export const displayService = {
  /**
   * Register a display as online. If it doesn't exist in DB, create it.
   */
  async register(displayId: string, displayName?: string): Promise<void> {
    if (!displayId || typeof displayId !== "string" || displayId.length > 100) {
      throw new Error("Invalid displayId");
    }
    onlineDisplays.add(displayId);
    const existing = await prisma.display.findUnique({ where: { id: displayId } });
    if (!existing) {
      await prisma.display.create({
        data: { id: displayId, name: displayName ?? null },
      });
    } else if (displayName && displayName !== existing.name) {
      await prisma.display.update({
        where: { id: displayId },
        data: { name: displayName, lastSeenAt: new Date() },
      });
    } else {
      await prisma.display.update({
        where: { id: displayId },
        data: { lastSeenAt: new Date() },
      });
    }
    logger.info("Display registered", { displayId, displayName });
  },

  /**
   * Mark a display as offline.
   */
  async unregister(displayId: string): Promise<void> {
    if (!onlineDisplays.has(displayId)) return;
    onlineDisplays.delete(displayId);
    await prisma.display.update({
      where: { id: displayId },
      data: { lastSeenAt: new Date() },
    }).catch(() => {
      // ignore
    });
    logger.info("Display unregistered", { displayId });
  },

  isOnline(displayId: string): boolean {
    return onlineDisplays.has(displayId);
  },

  async list(): Promise<DisplayInfo[]> {
    const displays = await prisma.display.findMany({
      orderBy: [{ lastSeenAt: "desc" }],
    });
    return displays.map(toDto);
  },
};
