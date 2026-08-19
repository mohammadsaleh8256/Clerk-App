import { useCallback, useEffect, useRef, useState } from "react";
import { WsClient } from "../websocket/WsClient.js";
import type {
  ServerMessage,
  QueueItemDto,
  DisplayInfo,
} from "@shared/websocket-types/index.js";

export interface QueueSnapshot {
  current: QueueItemDto | null;
  waiting: QueueItemDto[];
}

export type WsStatus = "connecting" | "connected" | "disconnected";

interface UseAdminWsResult {
  status: WsStatus;
  queue: QueueSnapshot;
  displays: DisplayInfo[];
  callPerson: (personId: number, displayId?: string | null) => void;
  replay: (displayId?: string | null) => void;
  skip: (queueItemId: number) => void;
  cancel: (queueItemId: number) => void;
  deleteQueueItem: (queueItemId: number) => void;
  clearQueue: (includePlaying?: boolean) => void;
}

export function useAdminWs(): UseAdminWsResult {
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const [queue, setQueue] = useState<QueueSnapshot>({ current: null, waiting: [] });
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    const client = new WsClient({
      clientType: "admin",
      onStatusChange: (s) => setStatus(s),
      onMessage: (msg: ServerMessage) => {
        switch (msg.type) {
          case "QUEUE_UPDATED":
          case "SYNC_STATE":
            setQueue({
              current: msg.payload!.current,
              waiting: msg.payload!.waiting,
            });
            break;
          case "DISPLAYS_UPDATED":
            setDisplays(msg.payload!.displays);
            break;
          // ignore other messages
          default:
            break;
        }
      },
    });
    clientRef.current = client;
    client.connect();

    // Initial REST fetches to populate state before WS messages arrive
    (async () => {
      try {
        const [q, d] = await Promise.all([
          fetch("/api/queue").then((r) => r.json()),
          fetch("/api/displays").then((r) => r.json()),
        ]);
        setQueue({ current: q.current, waiting: q.waiting });
        setDisplays(d);
      } catch {
        // ignore
      }
    })();

    return () => {
      client.close();
    };
  }, []);

  const callPerson = useCallback((personId: number, displayId?: string | null) => {
    clientRef.current?.send({
      type: "CALL_PERSON",
      payload: { personId, displayId: displayId || undefined },
    });
  }, []);

  const replay = useCallback((displayId?: string | null) => {
    clientRef.current?.send({
      type: "REPLAY",
      payload: { displayId: displayId || undefined },
    });
  }, []);

  const skip = useCallback((queueItemId: number) => {
    clientRef.current?.send({ type: "SKIP", payload: { queueItemId } });
  }, []);

  const cancel = useCallback((queueItemId: number) => {
    clientRef.current?.send({ type: "CANCEL", payload: { queueItemId } });
  }, []);

  const deleteQueueItem = useCallback((queueItemId: number) => {
    clientRef.current?.send({ type: "DELETE_QUEUE_ITEM", payload: { queueItemId } });
  }, []);

  const clearQueue = useCallback((includePlaying = false) => {
    clientRef.current?.send({ type: "CLEAR_QUEUE" });
    // Also call REST to be sure (REST endpoint respects includePlaying param)
    fetch("/api/queue/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includePlaying }),
    }).catch(() => {});
  }, []);

  return {
    status,
    queue,
    displays,
    callPerson,
    replay,
    skip,
    cancel,
    deleteQueueItem,
    clearQueue,
  };
}
