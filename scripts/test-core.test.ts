import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { personService } from "../src/server/services/personService.js";
import { queueService } from "../src/server/services/queueService.js";
import { displayService } from "../src/server/services/displayService.js";
import { prisma } from "../src/server/services/prisma.js";

// Clean DB before tests
async function cleanDb() {
  await prisma.callHistory.deleteMany();
  await prisma.queueItem.deleteMany();
  await prisma.display.deleteMany();
  await prisma.person.deleteMany();
}

beforeAll(async () => {
  await cleanDb();
  // Create test display for queue tests
  await displayService.register("tv-test", "Test TV");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PersonService", () => {
  it("should create a person", async () => {
    const p = await personService.create({ number: 1, name: "Test User 1" });
    expect(p.id).toBeGreaterThan(0);
    expect(p.number).toBe(1);
    expect(p.name).toBe("Test User 1");
    expect(p.active).toBe(true);
  });

  it("should reject duplicate number", async () => {
    await personService.create({ number: 2, name: "Test User 2" });
    await expect(personService.create({ number: 2, name: "Test User 2b" })).rejects.toThrow();
  });

  it("should reject empty name", async () => {
    await expect(personService.create({ number: 3, name: "" })).rejects.toThrow();
  });

  it("should reject invalid number", async () => {
    await expect(personService.create({ number: -5, name: "Bad" })).rejects.toThrow();
  });

  it("should list only active persons", async () => {
    await personService.create({ number: 100, name: "Active One", active: true });
    const inactive = await personService.create({ number: 101, name: "Inactive One", active: false });
    expect(inactive.active).toBe(false);

    const active = await personService.list(false);
    const all = await personService.listAll();

    expect(active.find((p) => p.id === inactive.id)).toBeUndefined();
    expect(all.find((p) => p.id === inactive.id)).toBeDefined();
  });

  it("should update person", async () => {
    const p = await personService.create({ number: 200, name: "Original" });
    const updated = await personService.update(p.id, { name: "Updated" });
    expect(updated.name).toBe("Updated");
  });

  it("should toggle active state", async () => {
    const p = await personService.create({ number: 300, name: "Toggle Me", active: true });
    const off = await personService.update(p.id, { active: false });
    expect(off.active).toBe(false);
    const on = await personService.update(p.id, { active: true });
    expect(on.active).toBe(true);
  });

  it("should delete person and cascade queue items", async () => {
    const p = await personService.create({ number: 400, name: "To Delete" });
    await queueService.enqueue({ personId: p.id });
    await personService.delete(p.id);

    const got = await personService.get(p.id);
    expect(got).toBeNull();

    // Queue items should be cascade-deleted
    const items = await prisma.queueItem.findMany({ where: { personId: p.id } });
    expect(items.length).toBe(0);
  });
});

describe("QueueService", () => {
  it("should enqueue a person and order by createdAt", async () => {
    const p1 = await personService.create({ number: 1000, name: "P1" });
    await new Promise((r) => setTimeout(r, 10));
    const p2 = await personService.create({ number: 1001, name: "P2" });
    await new Promise((r) => setTimeout(r, 10));
    const p3 = await personService.create({ number: 1002, name: "P3" });

    await queueService.enqueue({ personId: p1.id });
    await new Promise((r) => setTimeout(r, 10));
    await queueService.enqueue({ personId: p2.id });
    await new Promise((r) => setTimeout(r, 10));
    await queueService.enqueue({ personId: p3.id });

    const snap = await queueService.snapshot();
    expect(snap.waiting.length).toBeGreaterThanOrEqual(3);
    // First waiting should be p1 (oldest)
    expect(snap.waiting[0].number).toBe(1000);
  });

  it("should prevent duplicate enqueue by default", async () => {
    const p = await personService.create({ number: 2000, name: "Dup" });
    await queueService.enqueue({ personId: p.id });
    await expect(queueService.enqueue({ personId: p.id })).rejects.toThrow();
  });

  it("should start, then complete, an item", async () => {
    const p = await personService.create({ number: 3000, name: "Flow" });
    const { item } = await queueService.enqueue({ personId: p.id });
    const started = await queueService.start(item.id, "tv-test");
    expect(started.status).toBe("PLAYING");
    expect(started.startedAt).not.toBeNull();
    const completed = await queueService.complete(item.id);
    expect(completed?.status).toBe("COMPLETED");
    expect(completed?.completedAt).not.toBeNull();
  });

  it("should cancel an item", async () => {
    const p = await personService.create({ number: 4000, name: "Cancel" });
    const { item } = await queueService.enqueue({ personId: p.id });
    const started = await queueService.start(item.id, "tv-test");
    const cancelled = await queueService.cancel(item.id);
    expect(cancelled?.status).toBe("CANCELLED");
  });

  it("should skip an item (treated as completed)", async () => {
    const p = await personService.create({ number: 5000, name: "Skip" });
    const { item } = await queueService.enqueue({ personId: p.id });
    await queueService.start(item.id, "tv-test");
    const skipped = await queueService.skip(item.id);
    expect(skipped?.status).toBe("COMPLETED");
  });

  it("should delete a queue item", async () => {
    const p = await personService.create({ number: 6000, name: "Delete Q" });
    const { item } = await queueService.enqueue({ personId: p.id });
    await queueService.delete(item.id);
    const snap = await queueService.snapshot();
    expect(snap.waiting.find((x) => x.id === item.id)).toBeUndefined();
  });

  it("should clear waiting queue without touching playing", async () => {
    const p1 = await personService.create({ number: 7000, name: "C1" });
    const p2 = await personService.create({ number: 7001, name: "C2" });
    const { item } = await queueService.enqueue({ personId: p1.id });
    await queueService.start(item.id, "tv-test");
    await queueService.enqueue({ personId: p2.id });

    const result = await queueService.clearWaiting();
    expect(result.count).toBeGreaterThanOrEqual(1);

    const snap = await queueService.snapshot();
    expect(snap.current).not.toBeNull(); // playing should remain
  });

  it("should replay the most recent completed call", async () => {
    const p = await personService.create({ number: 8000, name: "Replay" });
    const { item } = await queueService.enqueue({ personId: p.id });
    await queueService.start(item.id, "tv-test");
    await queueService.complete(item.id);

    const replayed = await queueService.replay();
    expect(replayed).not.toBeNull();
    expect(replayed?.number).toBe(8000);
    expect(replayed?.status).toBe("WAITING");
  });

  it("should return null when nothing to replay", async () => {
    await cleanDb();
    await displayService.register("tv-test", "Test TV");
    const r = await queueService.replay();
    expect(r).toBeNull();
  });

  it("should restore PLAYING items to WAITING on startup recovery", async () => {
    const p = await personService.create({ number: 9000, name: "Recover" });
    const { item } = await queueService.enqueue({ personId: p.id });
    await queueService.start(item.id, "tv-test");

    const result = await queueService.recoverOnStartup();
    expect(result.restoredToWaiting).toBeGreaterThanOrEqual(1);

    const snap = await queueService.snapshot();
    const found = snap.waiting.find((x) => x.id === item.id);
    expect(found).toBeDefined();
    expect(found?.status).toBe("WAITING");
  });
});
