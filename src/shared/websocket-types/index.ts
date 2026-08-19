// Shared WebSocket types - type-safe protocol for both server and client
// این فایل بین سرور و کلاینت به اشتراک گذاشته می‌شود

export type ClientType = "admin" | "display";

export type QueueItemStatus = "WAITING" | "PLAYING" | "COMPLETED" | "CANCELLED" | "FAILED";

// ============================
// Base Message Type
// ============================
export interface BaseMessage<T extends string = string, P = unknown> {
  type: T;
  payload?: P;
}

// ============================
// Client -> Server Messages
// ============================
export interface RegisterMessage extends BaseMessage<"REGISTER", {
  clientType: ClientType;
  displayId?: string;
  displayName?: string;
}> {}

export interface CallPersonMessage extends BaseMessage<"CALL_PERSON", {
  personId: number;
  displayId?: string; // optional: route to specific display; if omitted -> broadcast
}> {}

export interface ReplayMessage extends BaseMessage<"REPLAY", {
  displayId?: string;
}> {}

export interface SkipMessage extends BaseMessage<"SKIP", {
  queueItemId: number;
}> {}

export interface CancelMessage extends BaseMessage<"CANCEL", {
  queueItemId: number;
}> {}

export interface DeleteQueueItemMessage extends BaseMessage<"DELETE_QUEUE_ITEM", {
  queueItemId: number;
}> {}

export interface ClearQueueMessage extends BaseMessage<"CLEAR_QUEUE"> {}

export interface PingMessage extends BaseMessage<"PING"> {}

export interface QueueItemStartedMessage extends BaseMessage<"QUEUE_ITEM_STARTED", {
  queueItemId: number;
}> {}

export interface QueueItemCompletedMessage extends BaseMessage<"QUEUE_ITEM_COMPLETED", {
  queueItemId: number;
}> {}

export interface QueueItemFailedMessage extends BaseMessage<"QUEUE_ITEM_FAILED", {
  queueItemId: number;
  error?: string;
}> {}

export type ClientMessage =
  | RegisterMessage
  | CallPersonMessage
  | ReplayMessage
  | SkipMessage
  | CancelMessage
  | DeleteQueueItemMessage
  | ClearQueueMessage
  | PingMessage
  | QueueItemStartedMessage
  | QueueItemCompletedMessage
  | QueueItemFailedMessage;

// ============================
// Server -> Client Messages
// ============================
export interface RegisteredMessage extends BaseMessage<"REGISTERED", {
  clientId: string;
  clientType: ClientType;
}> {}

export interface QueueItemDto {
  id: number;
  personId: number;
  number: number;
  name: string;
  audioFile: string | null;
  audioUrl: string | null;
  status: QueueItemStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  displayId: string | null;
}

export interface QueueUpdatedMessage extends BaseMessage<"QUEUE_UPDATED", {
  current: QueueItemDto | null;
  waiting: QueueItemDto[];
}> {}

export interface CallStartedMessage extends BaseMessage<"CALL_STARTED", {
  queueItem: QueueItemDto;
}> {}

export interface QueueItemStartedBroadcast extends BaseMessage<"QUEUE_ITEM_STARTED", {
  queueItem: QueueItemDto;
}> {}

export interface QueueItemCompletedBroadcast extends BaseMessage<"QUEUE_ITEM_COMPLETED", {
  queueItemId: number;
}> {}

export interface QueueItemCancelledBroadcast extends BaseMessage<"QUEUE_ITEM_CANCELLED", {
  queueItemId: number;
}> {}

export interface ReplayResultMessage extends BaseMessage<"REPLAY_RESULT", {
  queueItem: QueueItemDto;
}> {}

export interface DisplayInfo {
  id: string;
  name: string | null;
  connected: boolean;
  lastSeenAt: string | null;
}

export interface DisplaysUpdatedMessage extends BaseMessage<"DISPLAYS_UPDATED", {
  displays: DisplayInfo[];
}> {}

export interface DisplayStatusMessage extends BaseMessage<"DISPLAY_STATUS", {
  displayId: string;
  connected: boolean;
}> {}

export interface SyncStateMessage extends BaseMessage<"SYNC_STATE", {
  current: QueueItemDto | null;
  waiting: QueueItemDto[];
}> {}

export interface PongMessage extends BaseMessage<"PONG"> {}

export interface ErrorMessage extends BaseMessage<"ERROR", {
  code: string;
  message: string;
  details?: unknown;
}> {}

export type ServerMessage =
  | RegisteredMessage
  | QueueUpdatedMessage
  | CallStartedMessage
  | QueueItemStartedBroadcast
  | QueueItemCompletedBroadcast
  | QueueItemCancelledBroadcast
  | ReplayResultMessage
  | DisplaysUpdatedMessage
  | DisplayStatusMessage
  | SyncStateMessage
  | PongMessage
  | ErrorMessage;

// ============================
// Helpers
// ============================
export function isClientMessage(msg: unknown): msg is ClientMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as { type?: string };
  return [
    "REGISTER",
    "CALL_PERSON",
    "REPLAY",
    "SKIP",
    "CANCEL",
    "DELETE_QUEUE_ITEM",
    "CLEAR_QUEUE",
    "PING",
    "QUEUE_ITEM_STARTED",
    "QUEUE_ITEM_COMPLETED",
    "QUEUE_ITEM_FAILED",
  ].includes(m.type ?? "");
}

// Person DTO shared with REST API
export interface PersonDto {
  id: number;
  number: number;
  name: string;
  audioFile: string | null;
  audioUrl: string | null;
  hasAudio: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CallHistoryDto {
  id: number;
  personId: number;
  number: number;
  name: string;
  audioFile: string | null;
  status: string;
  calledAt: string;
  completedAt: string | null;
  displayId: string | null;
}
