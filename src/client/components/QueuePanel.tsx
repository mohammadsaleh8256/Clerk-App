import type { QueueItemDto } from "@shared/websocket-types/index.js";
import { ConfirmDialog } from "./Modal.js";
import { useState } from "react";

interface QueuePanelProps {
  current: QueueItemDto | null;
  waiting: QueueItemDto[];
  onDelete: (id: number) => void;
  onCancel: (id: number) => void;
  onSkip: (id: number) => void;
  onClearAll: () => void;
}

export function QueuePanel({ current, waiting, onDelete, onCancel, onSkip, onClearAll }: QueuePanelProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeletePlaying, setConfirmDeletePlaying] = useState<number | null>(null);

  return (
    <div className="card flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h3 className="font-bold">صف فراخوانی</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            {waiting.length} در انتظار
            {current ? " • 1 در حال پخش" : ""}
          </span>
          {(waiting.length > 0 || current) && (
            <button
              type="button"
              className="btn-danger text-xs px-2 py-1"
              onClick={() => setConfirmClear(true)}
            >
              پاک کردن صف
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {current && (
          <div className="mb-2 bg-blue-50 border-2 border-blue-300 rounded-lg p-3 animate-scale-in">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="badge-info">در حال پخش</span>
                  <span className="text-2xl font-bold text-blue-900" dir="ltr">
                    {current.number}
                  </span>
                </div>
                <div className="font-medium text-blue-900 truncate">{current.name}</div>
                {current.audioFile ? (
                  <div className="text-xs text-blue-700 mt-1">🔊 دارای فایل صوتی</div>
                ) : (
                  <div className="text-xs text-amber-700 mt-1">⚠ بدون فایل صوتی</div>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  className="btn-warning text-xs px-2 py-1"
                  onClick={() => onSkip(current.id)}
                  title="رد کردن و رفتن به بعدی"
                >
                  Skip
                </button>
                <button
                  type="button"
                  className="btn-danger text-xs px-2 py-1"
                  onClick={() => setConfirmDeletePlaying(current.id)}
                >
                  لغو
                </button>
              </div>
            </div>
          </div>
        )}

        {waiting.length === 0 && !current && (
          <div className="text-center text-slate-400 py-12 text-sm">
            صف خالی است
          </div>
        )}

        {waiting.length > 0 && (
          <ol className="space-y-1">
            {waiting.map((item, idx) => (
              <li
                key={item.id}
                className="bg-white border border-slate-200 rounded-lg p-2 flex items-center justify-between gap-2 hover:border-slate-300"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-xs text-slate-400 w-5 text-center">{idx + 1}</span>
                  <span className="text-lg font-bold text-slate-900 w-10 text-center" dir="ltr">
                    {item.number}
                  </span>
                  <span className="text-sm font-medium truncate">{item.name}</span>
                  {!item.audioFile && (
                    <span className="text-xs text-amber-600" title="بدون فایل صوتی">
                      ⚠
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="btn-danger text-xs px-2 py-1"
                    onClick={() => onDelete(item.id)}
                    title="حذف از صف"
                    aria-label={`حذف ${item.number} از صف`}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="پاک کردن صف"
        message="آیا مطمئن هستید که می‌خواهید تمام آیتم‌های در انتظار و در حال پخش را پاک کنید؟ این عمل قابل بازگشت نیست."
        confirmLabel="بله، پاک شود"
        danger
        onConfirm={() => {
          onClearAll();
          setConfirmClear(false);
        }}
        onCancel={() => setConfirmClear(false)}
      />

      <ConfirmDialog
        open={confirmDeletePlaying !== null}
        title="لغو فراخوانی در حال پخش"
        message="این فراخوانی در حال پخش است. آیا از لغو آن مطمئن هستید؟"
        confirmLabel="بله، لغو شود"
        danger
        onConfirm={() => {
          if (confirmDeletePlaying !== null) {
            onCancel(confirmDeletePlaying);
            setConfirmDeletePlaying(null);
          }
        }}
        onCancel={() => setConfirmDeletePlaying(null)}
      />
    </div>
  );
}
