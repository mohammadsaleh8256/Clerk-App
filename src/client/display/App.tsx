import { useCallback, useEffect, useRef, useState } from "react";
import "../styles/index.css";
import { WsClient } from "../websocket/WsClient.js";
import type {
  ServerMessage,
  QueueItemDto,
} from "@shared/websocket-types/index.js";

type WsStatus = "connecting" | "connected" | "disconnected";

interface PlaybackItem {
  queueItem: QueueItemDto;
  // local state
  startedAt: number;
}

// Generate or load displayId from localStorage
function getOrCreateDisplayId(): string {
  const key = "clerk-display-id";
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const id = `tv-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(key, id);
  return id;
}

function DisplayInner() {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const [current, setCurrent] = useState<PlaybackItem | null>(null);
  const [waiting, setWaiting] = useState<QueueItemDto[]>([]);
  const [now, setNow] = useState<Date>(new Date());
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [showClock, setShowClock] = useState(true);

  const clientRef = useRef<WsClient | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // playback queue (in-memory on display side)
  // we don't actually need a separate queue on display; we just play the `current`
  // and the server will send the next CALL_STARTED when this one completes.

  // Track which queueItemId we've already reported started/completed (to avoid double-reports)
  const reportedStartedRef = useRef<Set<number>>(new Set());
  const reportedCompletedRef = useRef<Set<number>>(new Set());

  // display ID
  const displayIdRef = useRef<string>(getOrCreateDisplayId());
  const displayNameRef = useRef<string>(`TV ${displayIdRef.current.slice(-4).toUpperCase()}`);

  // Update clock every second
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // WebSocket setup
  useEffect(() => {
    if (!audioEnabled) return;
    const client = new WsClient({
      clientType: "display",
      displayId: displayIdRef.current,
      displayName: displayNameRef.current,
      onStatusChange: (s) => setStatus(s),
      onMessage: (msg: ServerMessage) => {
        switch (msg.type) {
          case "CALL_STARTED": {
            const q = msg.payload!.queueItem;
            // Don't replay the same item if we already received it
            if (current && current.queueItem.id === q.id) return;
            reportedStartedRef.current.delete(q.id);
            reportedCompletedRef.current.delete(q.id);
            setCurrent({ queueItem: q, startedAt: Date.now() });
            setPlaybackError(null);
            break;
          }
          case "QUEUE_UPDATED":
          case "SYNC_STATE": {
            const c = msg.payload!.current;
            const w = msg.payload!.waiting;
            setWaiting(w);
            // If the server says there's a current item but we don't have it,
            // adopt it (this can happen after reconnect).
            if (c) {
              setCurrent((prev) => {
                if (prev && prev.queueItem.id === c.id) return prev;
                return { queueItem: c, startedAt: Date.now() };
              });
            } else {
              // Server says nothing is playing; clear our current too
              setCurrent(null);
            }
            break;
          }
          case "QUEUE_ITEM_CANCELLED": {
            const id = msg.payload!.queueItemId;
            setCurrent((prev) => {
              if (prev && prev.queueItem.id === id) {
                // Stop audio
                if (audioRef.current) {
                  audioRef.current.pause();
                  audioRef.current.src = "";
                }
                return null;
              }
              return prev;
            });
            break;
          }
          default:
            break;
        }
      },
    });
    clientRef.current = client;
    client.connect();
    return () => {
      client.close();
    };
  }, [audioEnabled]);

  // Play audio when current changes
  useEffect(() => {
    if (!current || !audioEnabled) return;
    const audio = audioRef.current;
    if (!audio) return;

    const q = current.queueItem;

    // If this item has no audio, immediately report completion
    if (!q.audioUrl) {
      const t = setTimeout(() => {
        if (!reportedCompletedRef.current.has(q.id)) {
          reportedCompletedRef.current.add(q.id);
          clientRef.current?.send({ type: "QUEUE_ITEM_COMPLETED", payload: { queueItemId: q.id } });
        }
      }, 1500); // brief display
      return () => clearTimeout(t);
    }

    // Set audio src
    audio.src = q.audioUrl;
    audio.load();

    // Report started after a tiny delay (to ensure src set)
    const startTimer = setTimeout(() => {
      if (!reportedStartedRef.current.has(q.id)) {
        reportedStartedRef.current.add(q.id);
        clientRef.current?.send({ type: "QUEUE_ITEM_STARTED", payload: { queueItemId: q.id } });
      }
    }, 100);

    const onEnded = () => {
      if (!reportedCompletedRef.current.has(q.id)) {
        reportedCompletedRef.current.add(q.id);
        clientRef.current?.send({ type: "QUEUE_ITEM_COMPLETED", payload: { queueItemId: q.id } });
      }
    };

    const onError = () => {
      setPlaybackError("خطا در پخش فایل صوتی");
      if (!reportedCompletedRef.current.has(q.id)) {
        reportedCompletedRef.current.add(q.id);
        clientRef.current?.send({
          type: "QUEUE_ITEM_FAILED",
          payload: { queueItemId: q.id, error: "Audio playback error" },
        });
      }
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    // Attempt to play (we have user gesture from "فعال‌سازی" button)
    audio.play().catch((e) => {
      setPlaybackError(`پخش ناموفق: ${e.message}`);
      if (!reportedCompletedRef.current.has(q.id)) {
        reportedCompletedRef.current.add(q.id);
        clientRef.current?.send({
          type: "QUEUE_ITEM_FAILED",
          payload: { queueItemId: q.id, error: e.message },
        });
      }
    });

    return () => {
      clearTimeout(startTimer);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [current, audioEnabled]);

  // Fullscreen handling
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setShowFullscreen(true);
      } else {
        await document.exitFullscreen();
        setShowFullscreen(false);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setShowFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ============================
  // Audio activation screen
  // ============================
  if (!audioEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 text-white">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="text-6xl mb-6">🔊</div>
          <h1 className="text-4xl font-bold mb-2">سیستم فراخوانی</h1>
          <p className="text-slate-300 mb-8">برای شروع، لطفاً روی دکمه زیر کلیک کنید تا صدا فعال شود.</p>
          <button
            type="button"
            className="bg-brand-600 hover:bg-brand-700 text-white font-bold text-xl px-12 py-4 rounded-xl shadow-lg transition-all hover:scale-105 active:scale-95"
            onClick={() => {
              // Pre-create audio element and play a silent buffer to unlock autoplay
              const audio = audioRef.current;
              if (audio) {
                audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
                audio.play().then(() => {
                  audio.pause();
                  audio.currentTime = 0;
                  setAudioEnabled(true);
                }).catch(() => {
                  // Even if silent play fails, allow proceeding (user gesture is recorded)
                  setAudioEnabled(true);
                });
              } else {
                setAudioEnabled(true);
              }
            }}
          >
            شروع
          </button>
          <p className="text-xs text-slate-400 mt-6">
            شناسه نمایش: {displayIdRef.current}
          </p>
        </div>
        <audio ref={audioRef} preload="auto" />
      </div>
    );
  }

  // ============================
  // Main display
  // ============================
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex flex-col">
      {/* Hidden audio element */}
      <audio ref={audioRef} preload="auto" />

      {/* Top status bar */}
      <div className="absolute top-0 right-0 left-0 p-4 flex items-center justify-between text-sm z-10">
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full ${
              status === "connected"
                ? "bg-green-500/20 text-green-300"
                : status === "connecting"
                ? "bg-amber-500/20 text-amber-300"
                : "bg-red-500/20 text-red-300"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                status === "connected"
                  ? "bg-green-400"
                  : status === "connecting"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-red-400"
              }`}
            />
            {status === "connected" ? "🟢 متصل" : status === "connecting" ? "🟡 در حال اتصال..." : "🔴 ارتباط با سرور قطع است"}
          </div>
          {waiting.length > 0 && (
            <div className="px-3 py-1 rounded-full bg-white/10 text-white/80">
              {waiting.length} نفر در انتظار
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 transition"
            onClick={() => setShowClock((v) => !v)}
            aria-label="نمایش/پنهان کردن ساعت"
          >
            🕐
          </button>
          <button
            type="button"
            className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 transition"
            onClick={toggleFullscreen}
            aria-label="تغییر حالت تمام صفحه"
          >
            {showFullscreen ? "🗗 خروج از تمام صفحه" : "🖥 تمام صفحه"}
          </button>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4">
        {current ? (
          <div key={current.queueItem.id} className="text-center animate-scale-in">
            <div className="text-2xl text-slate-300 mb-6">لطفاً مراجعه فرمایید</div>
            <div
              className="font-black leading-none mb-8"
              style={{
                fontSize: "clamp(12rem, 30vw, 24rem)",
                textShadow: "0 0 60px rgba(59, 130, 246, 0.5)",
              }}
              dir="ltr"
            >
              {current.queueItem.number}
            </div>
            <div
              className="font-bold mb-4"
              style={{ fontSize: "clamp(3rem, 6vw, 6rem)" }}
            >
              {current.queueItem.name}
            </div>
            {playbackError && (
              <div className="mt-6 text-amber-300 text-xl">⚠ {playbackError}</div>
            )}
            {!current.queueItem.audioUrl && (
              <div className="mt-6 text-slate-400 text-xl">(بدون فایل صوتی)</div>
            )}
          </div>
        ) : (
          <div className="text-center">
            <div className="text-4xl text-slate-300 mb-6">سیستم فراخوانی</div>
            <div className="text-2xl text-slate-400">آماده فراخوانی</div>
            {waiting.length > 0 && (
              <div className="mt-8 text-slate-400">
                <div className="text-lg mb-2">در انتظار:</div>
                <div className="flex flex-wrap gap-2 justify-center max-w-2xl">
                  {waiting.slice(0, 10).map((w) => (
                    <div
                      key={w.id}
                      className="bg-white/10 px-4 py-2 rounded-lg"
                      dir="ltr"
                    >
                      <span className="font-bold text-xl">{w.number}</span>
                      <span className="text-sm text-slate-400 mr-2">{w.name}</span>
                    </div>
                  ))}
                  {waiting.length > 10 && (
                    <div className="bg-white/5 px-4 py-2 rounded-lg text-slate-500">
                      +{waiting.length - 10}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom: clock */}
      {showClock && (
        <div className="absolute bottom-4 right-4 text-right">
          <div className="text-2xl font-mono font-bold" dir="ltr">
            {now.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="text-sm text-slate-400">
            {now.toLocaleDateString("fa-IR", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>
      )}

      {/* Bottom-left: display ID */}
      <div className="absolute bottom-4 left-4 text-xs text-slate-500">
        {displayIdRef.current}
      </div>
    </div>
  );
}

export default function DisplayApp() {
  return <DisplayInner />;
}
