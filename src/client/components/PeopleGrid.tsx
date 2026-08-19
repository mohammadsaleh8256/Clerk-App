import type { PersonDto } from "@shared/websocket-types/index.js";

interface PeopleGridProps {
  people: PersonDto[];
  callingId: number | null;
  onCall: (person: PersonDto) => void;
  onEdit: (person: PersonDto) => void;
  onDelete: (person: PersonDto) => void;
  onToggleActive: (person: PersonDto) => void;
}

export function PeopleGrid({
  people,
  callingId,
  onCall,
  onEdit,
  onDelete,
  onToggleActive,
}: PeopleGridProps) {
  if (people.length === 0) {
    return (
      <div className="card p-8 text-center text-slate-500">
        <div className="text-4xl mb-2">👥</div>
        <p>هنوز شخصی اضافه نشده است.</p>
        <p className="text-sm mt-1">از دکمه «افزودن شخص» استفاده کنید.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {people.map((person) => (
        <div
          key={person.id}
          className={`card p-3 flex flex-col gap-2 ${
            !person.active ? "opacity-50" : ""
          }`}
        >
          <div className="text-center">
            <div className="text-3xl font-bold text-slate-900" dir="ltr">
              {person.number}
            </div>
            <div className="text-sm font-medium truncate" title={person.name}>
              {person.name}
            </div>
            <div className="flex items-center justify-center gap-1 mt-1 text-xs">
              {person.hasAudio ? (
                <span className="badge-success" title="دارای فایل صوتی">
                  🔊 صدا
                </span>
              ) : (
                <span className="badge-muted" title="بدون فایل صوتی">
                  🔇 بی‌صدا
                </span>
              )}
              {!person.active && <span className="badge-warn">غیرفعال</span>}
            </div>
          </div>
          <button
            type="button"
            className="btn-primary w-full py-2 text-base"
            disabled={!person.active || callingId === person.id}
            onClick={() => onCall(person)}
            aria-label={`فراخوانی شماره ${person.number} ${person.name}`}
          >
            {callingId === person.id ? "..." : "فراخوانی"}
          </button>
          <div className="flex justify-center gap-1">
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1"
              onClick={() => onEdit(person)}
              title="ویرایش"
            >
              ✏ ویرایش
            </button>
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1"
              onClick={() => onToggleActive(person)}
              title={person.active ? "غیرفعال کردن" : "فعال کردن"}
            >
              {person.active ? "⛔ غیرفعال" : "✅ فعال"}
            </button>
            <button
              type="button"
              className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
              onClick={() => onDelete(person)}
              title="حذف"
            >
              🗑 حذف
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
