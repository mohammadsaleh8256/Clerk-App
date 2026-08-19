import { useCallback, useEffect, useState } from "react";
import "../styles/index.css";
import { ToastProvider, useToast } from "../components/Toast.js";
import { PersonFormModal } from "../components/PersonFormModal.js";
import { PeopleGrid } from "../components/PeopleGrid.js";
import { QueuePanel } from "../components/QueuePanel.js";
import { DisplaysList } from "../components/DisplaysList.js";
import { HistoryModal } from "../components/HistoryModal.js";
import { ConfirmDialog, Modal } from "../components/Modal.js";
import { useAdminWs } from "../hooks/useAdminWs.js";
import { api } from "../websocket/api.js";
import type { PersonDto } from "@shared/websocket-types/index.js";

function AdminInner() {
  const toast = useToast();
  const ws = useAdminWs();
  const [people, setPeople] = useState<PersonDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [callingId, setCallingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PersonDto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PersonDto | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const refreshPeople = useCallback(async () => {
    try {
      const list = await api.listPeople(includeInactive);
      setPeople(list);
    } catch (e) {
      toast.push("error", `خطا در بارگذاری افراد: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [includeInactive, toast]);

  useEffect(() => {
    refreshPeople();
  }, [refreshPeople]);

  const handleCall = useCallback(
    async (person: PersonDto) => {
      setCallingId(person.id);
      try {
        await api.callPerson(person.id);
        toast.push("success", `فراخوانی شماره ${person.number} - ${person.name}`);
      } catch (e) {
        toast.push("error", (e as Error).message);
      } finally {
        setTimeout(() => setCallingId(null), 800);
      }
    },
    [toast],
  );

  const handleEdit = (p: PersonDto) => {
    setEditing(p);
    setFormOpen(true);
  };

  const handleAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const handleDelete = (p: PersonDto) => {
    setConfirmDelete(p);
  };

  const confirmDeleteAction = async () => {
    if (!confirmDelete) return;
    try {
      await api.deletePerson(confirmDelete.id);
      toast.push("success", "شخص حذف شد");
      refreshPeople();
    } catch (e) {
      toast.push("error", (e as Error).message);
    } finally {
      setConfirmDelete(null);
    }
  };

  const handleToggleActive = async (p: PersonDto) => {
    try {
      await api.updatePerson(p.id, { active: !p.active });
      toast.push("success", p.active ? "شخص غیرفعال شد" : "شخص فعال شد");
      refreshPeople();
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-600 text-white rounded-lg flex items-center justify-center font-bold text-lg">
              ﷽
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">سیستم فراخوانی</h1>
              <div className="text-xs text-slate-500">پنل مدیریت</div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* WS status */}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs ${
                ws.status === "connected"
                  ? "bg-green-50 text-green-700"
                  : ws.status === "connecting"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-red-50 text-red-700"
              }`}
              title={`وضعیت WebSocket: ${ws.status}`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  ws.status === "connected"
                    ? "bg-green-500"
                    : ws.status === "connecting"
                    ? "bg-amber-500 animate-pulse"
                    : "bg-red-500"
                }`}
              />
              {ws.status === "connected" ? "متصل" : ws.status === "connecting" ? "در حال اتصال" : "قطع"}
            </div>

            {/* Displays */}
            <div className="text-xs">
              <DisplaysList displays={ws.displays} />
            </div>

            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => setHistoryOpen(true)}
            >
              📜 تاریخچه
            </button>

            <button type="button" className="btn-primary text-sm" onClick={handleAdd}>
              ＋ افزودن شخص
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold">افراد ({people.length})</h2>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
                className="w-4 h-4 accent-brand-600"
              />
              نمایش افراد غیرفعال
            </label>
          </div>
          {loading ? (
            <div className="card p-8 text-center text-slate-500">در حال بارگذاری...</div>
          ) : (
            <PeopleGrid
              people={people}
              callingId={callingId}
              onCall={handleCall}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleActive={handleToggleActive}
            />
          )}

          {/* Replay button */}
          <div className="mt-4 flex justify-start">
            <button
              type="button"
              className="btn-warning"
              onClick={() => {
                ws.replay();
                toast.push("info", "آخرین فراخوانی تکرار شد");
              }}
              disabled={ws.status !== "connected"}
            >
              🔊 تکرار آخرین فراخوانی
            </button>
          </div>
        </section>

        <aside className="lg:sticky lg:top-[88px] lg:self-start lg:h-[calc(100vh-104px)]">
          <QueuePanel
            current={ws.queue.current}
            waiting={ws.queue.waiting}
            onDelete={(id) => {
              ws.deleteQueueItem(id);
              toast.push("info", "آیتم از صف حذف شد");
            }}
            onCancel={(id) => {
              ws.cancel(id);
              toast.push("info", "فراخوانی لغو شد");
            }}
            onSkip={(id) => {
              ws.skip(id);
              toast.push("info", "به آیتم بعدی رفت شد");
            }}
            onClearAll={() => {
              ws.clearQueue(true);
              toast.push("info", "صف پاک شد");
            }}
          />
        </aside>
      </main>

      <PersonFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={refreshPeople}
        person={editing}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="حذف شخص"
        message={
          confirmDelete
            ? `آیا از حذف «${confirmDelete.name}» (شماره ${confirmDelete.number}) مطمئن هستید؟ فایل صوتی و تاریخچه مربوطه نیز حذف خواهند شد.`
            : ""
        }
        confirmLabel="بله، حذف شود"
        danger
        onConfirm={confirmDeleteAction}
        onCancel={() => setConfirmDelete(null)}
      />

      <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}

export default function AdminApp() {
  return (
    <ToastProvider>
      <AdminInner />
    </ToastProvider>
  );
}
