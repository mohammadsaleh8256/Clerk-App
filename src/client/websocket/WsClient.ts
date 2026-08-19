import type { ClientMessage, ServerMessage, ClientType } from "@shared/websocket-types/index.js";

export type ServerMessageHandler = (msg: ServerMessage) => void;
export type ConnectionStatusHandler = (status: "connecting" | "connected" | "disconnected") => void;

interface WsClientOptions {
  clientType: ClientType;
  displayId?: string;
  displayName?: string;
  onMessage?: ServerMessageHandler;
  onStatusChange?: ConnectionStatusHandler;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private url: string;
  private options: WsClientOptions;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private status: "disconnected" | "connecting" | "connected" = "disconnected";
  private isManualClose = false;

  constructor(options: WsClientOptions) {
    this.options = options;
    // Build WebSocket URL from current location
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.url = `${proto}//${window.location.host}/ws`;
  }

  connect(): void {
    if (this.status === "connected" || this.status === "connecting") return;
    this.isManualClose = false;
    this.setStatus("connecting");

    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      // Send REGISTER
      this.send({
        type: "REGISTER",
        payload: {
          clientType: this.options.clientType,
          displayId: this.options.displayId,
          displayName: this.options.displayName,
        },
      });
      // Start heartbeat
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        this.options.onMessage?.(msg);
      } catch (e) {
        // ignore malformed messages
        console.warn("Invalid WS message", e);
      }
    };

    this.ws.onerror = () => {
      // will be handled by onclose
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.setStatus("disconnected");
      if (!this.isManualClose) {
        this.scheduleReconnect();
      }
    };
  }

  private heartbeatTimer: number | null = null;
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ type: "PING" });
    }, 25000);
  }
  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return;
    // Exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
    const base = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts));
    const delay = base + Math.random() * 500; // jitter
    this.reconnectAttempts++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  send(msg: ClientMessage): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  private setStatus(status: "connecting" | "connected" | "disconnected") {
    this.status = status;
    this.options.onStatusChange?.(status);
  }

  getStatus(): "connecting" | "connected" | "disconnected" {
    return this.status;
  }

  close(): void {
    this.isManualClose = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.setStatus("disconnected");
  }
}
