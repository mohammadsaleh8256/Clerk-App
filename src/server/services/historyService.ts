import { prisma } from "./prisma.js";

export const historyService = {
  async list(opts: {
    limit?: number;
    offset?: number;
    search?: string;
  } = {}): Promise<{ items: any[]; total: number }> {
    const limit = Math.min(opts.limit ?? 100, 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const search = opts.search?.trim();

    const where = search
      ? {
          OR: [
            { name: { contains: search } },
            { number: { equals: parseInt(search, 10) || -1 } },
          ],
        }
      : undefined;

    const [items, total] = await Promise.all([
      prisma.callHistory.findMany({
        where,
        orderBy: [{ calledAt: "desc" }],
        take: limit,
        skip: offset,
      }),
      prisma.callHistory.count({ where }),
    ]);

    return {
      items: items.map((h) => ({
        id: h.id,
        personId: h.personId,
        number: h.number,
        name: h.name,
        audioFile: h.audioFile,
        audioUrl: h.audioFile ? `/uploads/audio/${h.audioFile}` : null,
        status: h.status,
        calledAt: h.calledAt.toISOString(),
        completedAt: h.completedAt ? h.completedAt.toISOString() : null,
        displayId: h.displayId,
      })),
      total,
    };
  },
};
