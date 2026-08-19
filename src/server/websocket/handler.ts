import { WsServer, ClientMeta } from "./server.js";
import { queueService } from "../services/queueService.js";
import { displayService } from "../services/displayService.js";
import { logger } from "../utils/logger.js";
import { AppError, toErrorResponse } from "../utils/errors.js";
import type { QueueItemDto } from "@shared/websocket-types/index.js";

/**
 * Builds the deps for the WebSocket server.
 * All business logic lives here — the WsServer class is only transport.
 *
 * Pattern: pure logic methods (no client parameter) are exposed publicly so
 * REST routes can call them without needing a WebSocket client.
 * The `deps.onX(client, ...)` wrappers are for WebSocket clients only and add
 * error reporting back to the specific client.
 */
export function createWsHandler(wsServer: WsServer) {
  async function broadcastQueueState() {
    const snapshot = await queueService.snapshot();
    const msg = {
      type: "QUEUE_UPDATED" as const,
      payload: { current: snapshot.current, waiting: snapshot.waiting },
    };
    wsServer.broadcastToAdmins(msg);
    wsServer.broadcastToDisplays(msg);
  }

  async function broadcastDisplays() {
    const displays = await displayService.list();
    wsServer.broadcastToAdmins({
      type: "DISPLAYS_UPDATED",
      payload: { displays },
    });
  }

  /**
   * Pure logic: enqueue a person and try to dispatch the next call.
   * Throws AppError on failure (e.g. duplicate, person not found).
   * Used by both WebSocket handler and REST API.
   */
  async function callPerson(personId: number, displayId?: string | null): Promise<QueueItemDto> {
    const { item } = await queueService.enqueue({ personId, displayId: displayId || null });
    await broadcastQueueState();
    await dispatchNextCall();
    return item;
  }

  /**
   * Pure logic: replay the last completed call.
   * Throws if nothing to replay.
   */
  async function replayLast(displayId?: string | null): Promise<QueueItemDto | null> {
    const item = await queueService.replay(displayId || null);
    if (item) {
      wsServer.broadcastToAdmins({ type: "REPLAY_RESULT", payload: { queueItem: item } });
      await broadcastQueueState();
      await dispatchNextCall();
    }
    return item;
  }

  async function skipQueueItem(queueItemId: number): Promise<void> {
    await queueService.skip(queueItemId);
    await broadcastQueueState();
    wsServer.broadcastToAdmins({
      type: "QUEUE_ITEM_COMPLETED",
      payload: { queueItemId },
    });
    await dispatchNextCall();
  }

  async function cancelQueueItem(queueItemId: number): Promise<void> {
    await queueService.cancel(queueItemId);
    wsServer.broadcastToAdmins({
      type: "QUEUE_ITEM_CANCELLED",
      payload: { queueItemId },
    });
    await broadcastQueueState();
    await dispatchNextCall();
  }

  async function deleteQueueItem(queueItemId: number): Promise<void> {
    await queueService.delete(queueItemId);
    await broadcastQueueState();
  }

  async function clearQueue(includePlaying = false): Promise<void> {
    if (includePlaying) {
      await queueService.clearAll();
    } else {
      await queueService.clearWaiting();
    }
    await broadcastQueueState();
    await dispatchNextCall();
  }

  async function dispatchNextCall(): Promise<void> {
    const snapshot = await queueService.snapshot();
    if (snapshot.current) return;

    const next = snapshot.waiting[0];
    if (!next) return;

    // Broadcast mode (v1): send to ALL connected displays.
    // If item.displayId is set, route only to that specific display.
    // Architecture supports adding more routing logic later.
    const displays = wsServer.getDisplays();
    if (displays.length === 0) {
      logger.info("No display online to dispatch next call", { queueItemId: next.id });
      return;
    }

    // If the item specifies a target display, only send to that one
    let targetDisplays: ClientMeta[];
    if (next.displayId) {
      const specific = wsServer.getDisplayById(next.displayId);
      targetDisplays = specific ? [specific] : [];
      if (targetDisplays.length === 0) {
        logger.info("Target display not online; broadcasting to all", {
          queueItemId: next.id,
          targetDisplayId: next.displayId,
        });
        targetDisplays = displays;
      }
    } else {
      // Broadcast to all
      targetDisplays = displays;
    }

    // Mark as PLAYING (once, regardless of how many displays will play)
    let started: QueueItemDto;
    try {
      // Use the first display's ID for record-keeping (the one that "started" the call)
      // Other displays will still receive CALL_STARTED.
      started = await queueService.start(next.id, targetDisplays[0].displayId);
    } catch (e) {
      logger.error("Failed to start queue item", {
        queueItemId: next.id,
        error: (e as Error).message,
      });
      await queueService.fail(next.id, (e as Error).message);
      await broadcastQueueState();
      setTimeout(() => dispatchNextCall().catch(() => {}), 100);
      return;
    }

    // Broadcast CALL_STARTED to all target displays
    const callStartedMsg = {
      type: "CALL_STARTED" as const,
      payload: { queueItem: started },
    };
    for (const display of targetDisplays) {
      wsServer.sendTo(display, callStartedMsg);
    }
    await broadcastQueueState();
    wsServer.broadcastToAdmins({
      type: "QUEUE_ITEM_STARTED",
      payload: { queueItem: started },
    });

    logger.info("Call dispatched to displays", {
      queueItemId: started.id,
      targetCount: targetDisplays.length,
      targetDisplays: targetDisplays.map((d) => d.displayId),
    });
  }

  // ============================
  // WebSocket-specific wrappers
  // ============================
  const deps = {
    async onRegister(client: ClientMeta, displayName?: string) {
      if (client.type === "display" && client.displayId) {
        try {
          await displayService.register(client.displayId, displayName);
        } catch (e) {
          logger.error("Failed to register display", { error: (e as Error).message });
        }
        await broadcastDisplays();
        wsServer.broadcastToAdmins({
          type: "DISPLAY_STATUS",
          payload: { displayId: client.displayId, connected: true },
        });
        const snapshot = await queueService.snapshot();
        wsServer.sendToDisplay(client.displayId, {
          type: "SYNC_STATE",
          payload: { current: snapshot.current, waiting: snapshot.waiting },
        });
        await dispatchNextCall();
      }
    },

    async onUnregister(client: ClientMeta) {
      if (client.type === "display" && client.displayId) {
        await displayService.unregister(client.displayId);
        await broadcastDisplays();
        wsServer.broadcastToAdmins({
          type: "DISPLAY_STATUS",
          payload: { displayId: client.displayId, connected: false },
        });
      }
    },

    async onCallPerson(client: ClientMeta, personId: number, displayId?: string | null) {
      try {
        await callPerson(personId, displayId);
      } catch (e) {
        // Only send error back to WebSocket client
        const err = toErrorResponse(e);
        wsServer.sendTo(client, {
          type: "ERROR",
          payload: { code: err.code, message: err.message, details: err.details },
        });
      }
    },

    async onReplay(client: ClientMeta, displayId?: string | null) {
      try {
        const item = await replayLast(displayId);
        if (!item) {
          wsServer.sendTo(client, {
            type: "ERROR",
            payload: { code: "NOTHING_TO_REPLAY", message: "هیچ فراخوانی قبلی برای تکرار وجود ندارد" },
          });
        }
      } catch (e) {
        const err = toErrorResponse(e);
        wsServer.sendTo(client, {
          type: "ERROR",
          payload: { code: err.code, message: err.message },
        });
      }
    },

    async onSkip(_client: ClientMeta, queueItemId: number) {
      await skipQueueItem(queueItemId);
    },

    async onCancel(_client: ClientMeta, queueItemId: number) {
      await cancelQueueItem(queueItemId);
    },

    async onDeleteQueueItem(_client: ClientMeta, queueItemId: number) {
      await deleteQueueItem(queueItemId);
    },

    async onClearQueue(_client: ClientMeta) {
      await clearQueue(true);
    },

    async onQueueItemStarted(client: ClientMeta, queueItemId: number) {
      logger.info("Display reports playback started", {
        displayId: client.displayId,
        queueItemId,
      });
    },

    async onQueueItemCompleted(_client: ClientMeta, queueItemId: number) {
      const completed = await queueService.complete(queueItemId);
      if (completed) {
        wsServer.broadcastToAdmins({
          type: "QUEUE_ITEM_COMPLETED",
          payload: { queueItemId },
        });
      }
      await broadcastQueueState();
      await dispatchNextCall();
    },

    async onQueueItemFailed(client: ClientMeta, queueItemId: number, error?: string) {
      logger.warn("Display reports playback failed", {
        displayId: client.displayId,
        queueItemId,
        error,
      });
      await queueService.fail(queueItemId, error);
      await broadcastQueueState();
      await dispatchNextCall();
    },
  };

  return {
    deps,
    // Pure logic — used by REST API routes
    callPerson,
    replayLast,
    skipQueueItem,
    cancelQueueItem,
    deleteQueueItem,
    clearQueue,
    // Internal
    dispatchNextCall,
    broadcastQueueState,
    broadcastDisplays,
  };
}

export type WsHandler = ReturnType<typeof createWsHandler>;
