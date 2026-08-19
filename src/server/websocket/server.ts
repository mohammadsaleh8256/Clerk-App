import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer } from "node:http";
import { logger } from "../utils/logger.js";
import type {
  ClientType,
  ServerMessage,
} from "@shared/websocket-types/index.js";

export interface ClientMeta {
  id: string;
  type: ClientType;
  displayId?: string;
  ws: WebSocket;
  lastPongAt: number;
  currentQueueItemId?: number | null;
}

export interface WsHandlerDeps {
  onRegister: (client: ClientMeta, displayName?: string) => void;
  onUnregister: (client: ClientMeta) => void;
  onCallPerson: (client: ClientMeta, personId: number, displayId?: string | null) => void;
  onReplay: (client: ClientMeta, displayId?: string | null) => void;
  onSkip: (client: ClientMeta, queueItemId: number) => void;
  onCancel: (client: ClientMeta, queueItemId: number) => void;
  onDeleteQueueItem: (client: ClientMeta, queueItemId: number) => void;
  onClearQueue: (client: ClientMeta) => void;
  onQueueItemStarted: (client: ClientMeta, queueItemId: number) => void;
  onQueueItemCompleted: (client: ClientMeta, queueItemId: number) => void;
  onQueueItemFailed: (client: ClientMeta, queueItemId: number, error?: string) => void;
}

let clientCounter = 0;
function genClientId(): string {
  clientCounter++;
  return `c-${Date.now().toString(36)}-${clientCounter}`;
}

export class WsServer {
  private wss: WebSocketServer;
  private clients = new Map<string, ClientMeta>();
  private displayToClient = new Map<string, string>();
  // Lazy deps — set by the app.ts after handler is constructed
  private deps: WsHandlerDeps = {
    onRegister: () => {},
    onUnregister: () => {},
    onCallPerson: () => {},
    onReplay: () => {},
    onSkip: () => {},
    onCancel: () => {},
    onDeleteQueueItem: () => {},
    onClearQueue: () => {},
    onQueueItemStarted: () => {},
    onQueueItemCompleted: () => {},
    onQueueItemFailed: () => {},
  };

  constructor(httpServer: HttpServer) {
    this.wss = new WebSocketServer({ noServer: true });
    this.setupUpgradeHandler(httpServer);
    this.setupConnectionHandler();
    this.startHeartbeat();
  }

  setDeps(deps: WsHandlerDeps): void {
    this.deps = deps;
  }

  private setupUpgradeHandler(httpServer: HttpServer) {
    httpServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      if (url.pathname === "/ws") {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit("connection", ws, req);
        });
      } else {
        socket.destroy();
      }
    });
  }

  private setupConnectionHandler() {
    this.wss.on("connection", (ws, req) => {
      const clientId = genClientId();
      const meta: ClientMeta = {
        id: clientId,
        type: "admin", // default until REGISTER
        ws,
        lastPongAt: Date.now(),
      };
      this.clients.set(clientId, meta);
      logger.info("WebSocket client connected", { clientId, url: req.url });

      ws.on("message", (raw) => this.onMessage(meta, raw.toString()));
      ws.on("close", () => this.onClose(meta));
      ws.on("error", (err) => {
        logger.warn("WebSocket client error", { clientId, error: err.message });
      });
      ws.on("pong", () => {
        meta.lastPongAt = Date.now();
      });
    });
  }

  private onMessage(meta: ClientMeta, raw: string) {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.sendTo(meta, { type: "ERROR", payload: { code: "INVALID_JSON", message: "JSON نامعتبر است" } });
      return;
    }

    if (typeof msg !== "object" || msg === null) {
      this.sendTo(meta, { type: "ERROR", payload: { code: "INVALID_MESSAGE", message: "پیام نامعتبر" } });
      return;
    }

    const m = msg as { type?: string; payload?: any };

    try {
      switch (m.type) {
        case "REGISTER": {
          const p = m.payload || {};
          if (p.clientType !== "admin" && p.clientType !== "display") {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "INVALID_CLIENT_TYPE", message: "نوع کلاینت نامعتبر" },
            });
            return;
          }
          meta.type = p.clientType;
          if (p.clientType === "display") {
            const displayId = (p.displayId || "").toString().trim();
            if (!displayId) {
              this.sendTo(meta, {
                type: "ERROR",
                payload: { code: "INVALID_DISPLAY_ID", message: "displayId الزامی است" },
              });
              return;
            }
            meta.displayId = displayId;
            this.displayToClient.set(displayId, meta.id);
          }
          this.sendTo(meta, {
            type: "REGISTERED",
            payload: { clientId: meta.id, clientType: meta.type },
          });
          this.deps.onRegister(meta, p.displayName);
          break;
        }
        case "CALL_PERSON": {
          if (meta.type !== "admin") {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "UNAUTHORIZED", message: "فقط ادمین می‌تواند فراخوانی کند" },
            });
            return;
          }
          const personId = Number(m.payload?.personId);
          if (!Number.isFinite(personId)) {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "INVALID_INPUT", message: "personId نامعتبر" },
            });
            return;
          }
          const displayId = m.payload?.displayId ? String(m.payload.displayId) : null;
          this.deps.onCallPerson(meta, personId, displayId);
          break;
        }
        case "REPLAY": {
          if (meta.type !== "admin") {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "UNAUTHORIZED", message: "فقط ادمین می‌تواند replay کند" },
            });
            return;
          }
          const displayId = m.payload?.displayId ? String(m.payload.displayId) : null;
          this.deps.onReplay(meta, displayId);
          break;
        }
        case "SKIP": {
          if (meta.type !== "admin") {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "UNAUTHORIZED", message: "فقط ادمین می‌تواند skip کند" },
            });
            return;
          }
          const queueItemId = Number(m.payload?.queueItemId);
          if (!Number.isFinite(queueItemId)) {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "INVALID_INPUT", message: "queueItemId نامعتبر" },
            });
            return;
          }
          this.deps.onSkip(meta, queueItemId);
          break;
        }
        case "CANCEL": {
          if (meta.type !== "admin") {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "UNAUTHORIZED", message: "فقط ادمین می‌تواند cancel کند" },
            });
            return;
          }
          const queueItemId = Number(m.payload?.queueItemId);
          if (!Number.isFinite(queueItemId)) {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "INVALID_INPUT", message: "queueItemId نامعتبر" },
            });
            return;
          }
          this.deps.onCancel(meta, queueItemId);
          break;
        }
        case "DELETE_QUEUE_ITEM": {
          if (meta.type !== "admin") {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "UNAUTHORIZED", message: "فقط ادمین می‌تواند حذف کند" },
            });
            return;
          }
          const queueItemId = Number(m.payload?.queueItemId);
          if (!Number.isFinite(queueItemId)) {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "INVALID_INPUT", message: "queueItemId نامعتبر" },
            });
            return;
          }
          this.deps.onDeleteQueueItem(meta, queueItemId);
          break;
        }
        case "CLEAR_QUEUE": {
          if (meta.type !== "admin") {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "UNAUTHORIZED", message: "فقط ادمین می‌تواند صف را پاک کند" },
            });
            return;
          }
          this.deps.onClearQueue(meta);
          break;
        }
        case "QUEUE_ITEM_STARTED": {
          if (meta.type !== "display") {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "UNAUTHORIZED", message: "فقط Display می‌تواند شروع کند" },
            });
            return;
          }
          const queueItemId = Number(m.payload?.queueItemId);
          if (!Number.isFinite(queueItemId)) {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "INVALID_INPUT", message: "queueItemId نامعتبر" },
            });
            return;
          }
          meta.currentQueueItemId = queueItemId;
          this.deps.onQueueItemStarted(meta, queueItemId);
          break;
        }
        case "QUEUE_ITEM_COMPLETED": {
          if (meta.type !== "display") {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "UNAUTHORIZED", message: "فقط Display می‌تواند complete کند" },
            });
            return;
          }
          const queueItemId = Number(m.payload?.queueItemId);
          if (!Number.isFinite(queueItemId)) {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "INVALID_INPUT", message: "queueItemId نامعتبر" },
            });
            return;
          }
          meta.currentQueueItemId = null;
          this.deps.onQueueItemCompleted(meta, queueItemId);
          break;
        }
        case "QUEUE_ITEM_FAILED": {
          if (meta.type !== "display") {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "UNAUTHORIZED", message: "فقط Display می‌تواند fail کند" },
            });
            return;
          }
          const queueItemId = Number(m.payload?.queueItemId);
          if (!Number.isFinite(queueItemId)) {
            this.sendTo(meta, {
              type: "ERROR",
              payload: { code: "INVALID_INPUT", message: "queueItemId نامعتبر" },
            });
            return;
          }
          meta.currentQueueItemId = null;
          this.deps.onQueueItemFailed(meta, queueItemId, m.payload?.error);
          break;
        }
        case "PING": {
          this.sendTo(meta, { type: "PONG" });
          break;
        }
        default:
          this.sendTo(meta, {
            type: "ERROR",
            payload: { code: "UNKNOWN_MESSAGE", message: `نوع پیام ناشناخته: ${m.type}` },
          });
      }
    } catch (e) {
      logger.error("Error processing message", { type: m.type, error: (e as Error).message });
      this.sendTo(meta, {
        type: "ERROR",
        payload: { code: "INTERNAL_ERROR", message: "خطای داخلی سرور" },
      });
    }
  }

  private onClose(meta: ClientMeta) {
    this.clients.delete(meta.id);
    if (meta.displayId) {
      const cur = this.displayToClient.get(meta.displayId);
      if (cur === meta.id) {
        this.displayToClient.delete(meta.displayId);
      }
      this.deps.onUnregister(meta);
    }
    logger.info("WebSocket client disconnected", { clientId: meta.id, type: meta.type });
  }

  private startHeartbeat() {
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [clientId, meta] of this.clients.entries()) {
        if (meta.ws.readyState !== WebSocket.OPEN) continue;
        if (now - meta.lastPongAt > 60000) {
          logger.warn("Terminating stale WebSocket connection", { clientId });
          try {
            meta.ws.terminate();
          } catch {
            // ignore
          }
          continue;
        }
        try {
          meta.ws.ping();
        } catch {
          // ignore
        }
      }
    }, 30000);
    interval.unref?.();
  }

  // ============================
  // Public API (used by handler)
  // ============================
  sendTo(meta: ClientMeta, msg: ServerMessage): void {
    if (meta.ws.readyState !== WebSocket.OPEN) return;
    try {
      meta.ws.send(JSON.stringify(msg));
    } catch (e) {
      logger.warn("Failed to send message to client", { clientId: meta.id, error: (e as Error).message });
    }
  }

  broadcastToAdmins(msg: ServerMessage): void {
    for (const meta of this.clients.values()) {
      if (meta.type === "admin" && meta.ws.readyState === WebSocket.OPEN) {
        this.sendTo(meta, msg);
      }
    }
  }

  broadcastToDisplays(msg: ServerMessage, exceptDisplayId?: string): void {
    for (const meta of this.clients.values()) {
      if (meta.type === "display" && meta.ws.readyState === WebSocket.OPEN) {
        if (exceptDisplayId && meta.displayId === exceptDisplayId) continue;
        this.sendTo(meta, msg);
      }
    }
  }

  sendToDisplay(displayId: string, msg: ServerMessage): boolean {
    const clientId = this.displayToClient.get(displayId);
    if (!clientId) return false;
    const meta = this.clients.get(clientId);
    if (!meta || meta.ws.readyState !== WebSocket.OPEN) return false;
    this.sendTo(meta, msg);
    return true;
  }

  getAdmins(): ClientMeta[] {
    return [...this.clients.values()].filter((m) => m.type === "admin");
  }

  getDisplays(): ClientMeta[] {
    return [...this.clients.values()].filter((m) => m.type === "display");
  }

  getDisplayById(displayId: string): ClientMeta | undefined {
    const clientId = this.displayToClient.get(displayId);
    if (!clientId) return undefined;
    return this.clients.get(clientId);
  }
}
