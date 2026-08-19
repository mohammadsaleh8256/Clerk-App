import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (kind: ToastKind, message: string, durationMs?: number) => void;
  remove: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let idCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string, durationMs = 4000) => {
    idCounter++;
    const id = idCounter;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, durationMs);
  }, []);

  const value = useMemo(() => ({ toasts, push, remove }), [toasts, push, remove]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

function ToastContainer() {
  const { toasts, remove } = useToast();
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 max-w-sm"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`animate-fade-in flex items-start gap-3 p-3 rounded-lg shadow-lg border ${
            t.kind === "success"
              ? "bg-green-50 border-green-300 text-green-900"
              : t.kind === "warning"
              ? "bg-amber-50 border-amber-300 text-amber-900"
              : t.kind === "error"
              ? "bg-red-50 border-red-300 text-red-900"
              : "bg-blue-50 border-blue-300 text-blue-900"
          }`}
        >
          <span className="flex-1 text-sm">{t.message}</span>
          <button
            type="button"
            onClick={() => remove(t.id)}
            className="text-xs opacity-60 hover:opacity-100"
            aria-label="بستن"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
