import type { DisplayInfo } from "@shared/websocket-types/index.js";

interface DisplaysListProps {
  displays: DisplayInfo[];
}

export function DisplaysList({ displays }: DisplaysListProps) {
  if (displays.length === 0) {
    return (
      <div className="text-xs text-slate-500">
        هنوز هیچ نمایشی متصل نشده است
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {displays.map((d) => (
        <div
          key={d.id}
          className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs border ${
            d.connected
              ? "bg-green-50 border-green-300 text-green-800"
              : "bg-slate-100 border-slate-300 text-slate-600"
          }`}
          title={d.lastSeenAt ? `آخرین اتصال: ${new Date(d.lastSeenAt).toLocaleString("fa-IR")}` : ""}
        >
          <span className={`w-2 h-2 rounded-full ${d.connected ? "bg-green-500" : "bg-slate-400"}`} />
          <span className="font-medium">{d.name || d.id}</span>
          <span className="opacity-60">({d.connected ? "متصل" : "قطع"})</span>
        </div>
      ))}
    </div>
  );
}
