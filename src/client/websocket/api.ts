import type { PersonDto, QueueItemDto, DisplayInfo, CallHistoryDto } from "@shared/websocket-types/index.js";

export interface QueueSnapshot {
  current: QueueItemDto | null;
  waiting: QueueItemDto[];
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (res.status === 204) return null as T;
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("پاسخ نامعتبر از سرور");
    }
  }
  if (!res.ok) {
    const err = body as { code?: string; message?: string };
    throw new Error(err?.message || `خطای سرور (${res.status})`);
  }
  return body as T;
}

export const api = {
  async listPeople(includeInactive = false): Promise<PersonDto[]> {
    const res = await fetch(`/api/people?includeInactive=${includeInactive}`);
    return jsonOrThrow(res);
  },

  async createPerson(input: { number: number; name: string; active?: boolean }): Promise<PersonDto> {
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return jsonOrThrow(res);
  },

  async updatePerson(id: number, input: { number?: number; name?: string; active?: boolean }): Promise<PersonDto> {
    const res = await fetch(`/api/people/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return jsonOrThrow(res);
  },

  async deletePerson(id: number): Promise<void> {
    const res = await fetch(`/api/people/${id}`, { method: "DELETE" });
    await jsonOrThrow(res);
  },

  async uploadAudio(id: number, file: File): Promise<PersonDto> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/people/${id}/audio`, {
      method: "POST",
      body: form,
    });
    return jsonOrThrow(res);
  },

  async deleteAudio(id: number): Promise<PersonDto> {
    const res = await fetch(`/api/people/${id}/audio`, { method: "DELETE" });
    return jsonOrThrow(res);
  },

  async callPerson(personId: number, displayId?: string): Promise<void> {
    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId, displayId }),
    });
    await jsonOrThrow(res);
  },

  async replay(displayId?: string): Promise<void> {
    const res = await fetch("/api/calls/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayId }),
    });
    await jsonOrThrow(res);
  },

  async getQueue(): Promise<QueueSnapshot> {
    const res = await fetch("/api/queue");
    return jsonOrThrow(res);
  },

  async deleteQueueItem(id: number): Promise<void> {
    const res = await fetch(`/api/queue/${id}`, { method: "DELETE" });
    await jsonOrThrow(res);
  },

  async cancelQueueItem(id: number): Promise<QueueItemDto> {
    const res = await fetch(`/api/queue/${id}/cancel`, { method: "POST" });
    return jsonOrThrow(res);
  },

  async skipQueueItem(id: number): Promise<QueueItemDto> {
    const res = await fetch(`/api/queue/${id}/skip`, { method: "POST" });
    return jsonOrThrow(res);
  },

  async clearQueue(opts: { includePlaying?: boolean } = {}): Promise<{ count: number }> {
    const res = await fetch("/api/queue/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    return jsonOrThrow(res);
  },

  async listDisplays(): Promise<DisplayInfo[]> {
    const res = await fetch("/api/displays");
    return jsonOrThrow(res);
  },

  async listHistory(opts: { limit?: number; offset?: number; search?: string } = {}): Promise<{ items: CallHistoryDto[]; total: number }> {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.offset) params.set("offset", String(opts.offset));
    if (opts.search) params.set("search", opts.search);
    const res = await fetch(`/api/history?${params.toString()}`);
    return jsonOrThrow(res);
  },
};
