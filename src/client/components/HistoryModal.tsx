import { useEffect, useState } from "react";
import { api } from "../websocket/api.js";
import type { CallHistoryDto } from "@shared/websocket-types/index.js";
import { Modal } from "./Modal.js";

interface HistoryModalProps {
  open: boolean;
  onClose: () => void;
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  COMPLETED: { label: "تکمیل شد", cls: "badge-success" },
  CANCELLED: { label: "لغو شد", cls: "badge-warn" },
  FAILED: { label: "ناموفق", cls: "badge-danger" },
};

export function HistoryModal({ open, onClose }: HistoryModalProps) {
  const [items, setItems] = useState<CallHistoryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const doFetch = async () => {
      setLoading(true);
      try {
        const res = await api.listHistory({ limit: 100, search });
        if (!cancelled) {
          setItems(res.items);
          setTotal(res.total);
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const t = setTimeout(doFetch, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, search]);

  return (
    <Modal open={open} onClose={onClose} title="تاریخچه فراخوانی‌ها" size="lg">
      <div className="space-y-3">
        <input
          type="text"
          className="input"
          placeholder="جستجو بر اساس نام یا شماره..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="text-xs text-slate-500">{total} مورد یافتش شد</div>
        <div className="max-h-[60vh] overflow-y-auto border border-slate-200 rounded-lg">
          {loading ? (
            <div className="p-8 text-center text-slate-500">در حال بارگذاری...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-slate-500">موردی یافت نشد</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-right p-2 font-medium">شماره</th>
                  <th className="text-right p-2 font-medium">نام</th>
                  <th className="text-right p-2 font-medium">وضعیت</th>
                  <th className="text-right p-2 font-medium">زمان فراخوانی</th>
                  <th className="text-right p-2 font-medium">نمایش</th>
                </tr>
              </thead>
              <tbody>
                {items.map((h) => (
                  <tr key={h.id} className="border-t border-slate-100">
                    <td className="p-2 font-bold" dir="ltr">{h.number}</td>
                    <td className="p-2">{h.name}</td>
                    <td className="p-2">
                      <span className={(STATUS_LABELS[h.status] || { cls: "badge-muted" }).cls}>
                        {(STATUS_LABELS[h.status] || { label: h.status }).label}
                      </span>
                    </td>
                    <td className="p-2 text-xs text-slate-600">
                      {new Date(h.calledAt).toLocaleString("fa-IR")}
                    </td>
                    <td className="p-2 text-xs text-slate-500">{h.displayId || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}
