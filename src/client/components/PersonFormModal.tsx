import { useEffect, useRef, useState } from "react";
import type { PersonDto } from "@shared/websocket-types/index.js";
import { api } from "../websocket/api.js";
import { Modal } from "./Modal.js";
import { useToast } from "./Toast.js";

interface PersonFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  person?: PersonDto | null;
}

const MAX_AUDIO_MB = 10;

export function PersonFormModal({ open, onClose, onSaved, person }: PersonFormModalProps) {
  const isEdit = !!person;
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [audioFile, setAudioFile] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioSize, setAudioSize] = useState<number | null>(null);
  const [audioMime, setAudioMime] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [audioForDelete, setAudioForDelete] = useState(false);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const audioPreviewRef = useRef<HTMLAudioElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (open) {
      setNumber(person ? String(person.number) : "");
      setName(person ? person.name : "");
      setActive(person ? person.active : true);
      setAudioFile(person?.audioFile ?? null);
      setAudioUrl(person?.audioUrl ?? null);
      setAudioSize(null);
      setAudioMime(null);
      setAudioName(null);
      setAudioForDelete(false);
    }
  }, [open, person]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // Validate locally first
    const allowedExt = [".mp3", ".wav", ".ogg"];
    const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
    if (!allowedExt.includes(ext)) {
      toast.push("error", `فرمت مجاز نیست. فقط: ${allowedExt.join(", ")}`);
      e.target.value = "";
      return;
    }
    if (f.size > MAX_AUDIO_MB * 1024 * 1024) {
      toast.push("error", `حداکثر حجم فایل ${MAX_AUDIO_MB} مگابایت است`);
      e.target.value = "";
      return;
    }
    setAudioSize(f.size);
    setAudioMime(f.type || "audio/unknown");
    setAudioName(f.name);
    setAudioUrl(URL.createObjectURL(f));
    setAudioForDelete(false);
  };

  const handleRemoveAudio = () => {
    setAudioSize(null);
    setAudioMime(null);
    setAudioName(null);
    setAudioUrl(null);
    if (audioFile) {
      setAudioForDelete(true); // mark for delete on save
    }
    if (audioInputRef.current) audioInputRef.current.value = "";
  };

  const handleSave = async () => {
    const num = parseInt(number, 10);
    if (!Number.isFinite(num) || num < 1) {
      toast.push("error", "شماره باید یک عدد صحیح مثبت باشد");
      return;
    }
    if (!name.trim()) {
      toast.push("error", "نام اجباری است");
      return;
    }
    setSaving(true);
    try {
      let saved: PersonDto;
      if (isEdit && person) {
        saved = await api.updatePerson(person.id, { number: num, name: name.trim(), active });
      } else {
        saved = await api.createPerson({ number: num, name: name.trim(), active });
      }

      // Audio handling
      if (audioInputRef.current?.files?.[0]) {
        setUploading(true);
        try {
          await api.uploadAudio(saved.id, audioInputRef.current.files[0]);
          toast.push("success", "فایل صوتی با موفقیت آپلود شد");
        } catch (e) {
          toast.push("error", `خطا در آپلود صوت: ${(e as Error).message}`);
        } finally {
          setUploading(false);
        }
      } else if (audioForDelete && isEdit && person) {
        try {
          await api.deleteAudio(person.id);
          toast.push("success", "فایل صوتی حذف شد");
        } catch (e) {
          toast.push("error", `خطا در حذف صوت: ${(e as Error).message}`);
        }
      }

      toast.push("success", isEdit ? "اطلاعات شخص ویرایش شد" : "شخص جدید اضافه شد");
      onSaved();
      onClose();
    } catch (e) {
      toast.push("error", (e as Error).message || "خطا در ذخیره‌سازی");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "ویرایش شخص" : "افزودن شخص جدید"} size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            شماره <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            className="input"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            min={1}
            dir="ltr"
            placeholder="مثلاً 25"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            نام <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="نام و نام خانوادگی"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="w-4 h-4 accent-brand-600"
          />
          <span className="text-sm">فعال (در لیست فراخوانی نمایش داده شود)</span>
        </label>

        <div className="border-t pt-4">
          <label className="block text-sm font-medium mb-2">فایل صوتی (اختیاری)</label>

          {audioUrl ? (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
              <div className="flex items-start justify-between gap-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate" title={audioName || audioFile || ""}>
                    {audioName || audioFile}
                  </div>
                  {audioSize !== null && (
                    <div className="text-slate-500 text-xs mt-1">
                      {(audioSize / 1024).toFixed(1)} کیلوبایت
                      {audioMime ? ` • ${audioMime}` : ""}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="btn-secondary text-xs px-2 py-1"
                    onClick={() => audioPreviewRef.current?.play()}
                    aria-label="پخش پیش‌نمایش"
                  >
                    ▶ پخش
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs px-2 py-1"
                    onClick={() => audioInputRef.current?.click()}
                    aria-label="جایگزینی فایل"
                  >
                    جایگزینی
                  </button>
                  <button
                    type="button"
                    className="btn-danger text-xs px-2 py-1"
                    onClick={handleRemoveAudio}
                    aria-label="حذف فایل"
                  >
                    حذف
                  </button>
                </div>
              </div>
              <audio ref={audioPreviewRef} src={audioUrl} controls className="w-full" preload="none" />
            </div>
          ) : (
            <button
              type="button"
              className="w-full border-2 border-dashed border-slate-300 hover:border-brand-500 rounded-lg p-6 text-center text-slate-600 hover:bg-slate-50 transition"
              onClick={() => audioInputRef.current?.click()}
            >
              <div className="text-3xl mb-2">🎵</div>
              <div className="text-sm">برای انتخاب فایل صوتی کلیک کنید</div>
              <div className="text-xs text-slate-500 mt-1">MP3, WAV, OGG - حداکثر {MAX_AUDIO_MB}MB</div>
            </button>
          )}
          <input
            ref={audioInputRef}
            type="file"
            accept=".mp3,.wav,.ogg,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/vorbis"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        <div className="flex justify-start gap-2 pt-2 border-t">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={saving || uploading}
          >
            انصراف
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={saving || uploading}
          >
            {saving ? "در حال ذخیره..." : uploading ? "در حال آپلود..." : "ذخیره"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
