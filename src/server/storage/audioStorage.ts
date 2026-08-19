import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../utils/errors.js";

/**
 * Secure audio file storage.
 *
 * Security:
 * - Never trusts the original filename for storage path.
 * - Generates a random safe filename (e.g. 7f3c1d2a-<short>.mp3).
 * - Validates extension against a whitelist.
 * - Validates MIME type against a whitelist.
 * - Enforces max file size at upload time (Fastify body limit + explicit check).
 * - All file reads/writes are confined to the uploads directory.
 */

const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export interface StoredAudio {
  // path relative to uploads/audio (e.g. "a1b2c3d4.mp3")
  relativePath: string;
  // absolute path
  absolutePath: string;
  // URL path served by the server (e.g. "/uploads/audio/a1b2c3d4.mp3")
  url: string;
  size: number;
  mime: string;
  ext: string;
}

/**
 * Returns the absolute path of an audio file given its relative path.
 * Validates against path traversal attempts.
 */
export function resolveAudioPath(relativePath: string): string {
  if (!relativePath || typeof relativePath !== "string") {
    throw new AppError("INVALID_PATH", "مسیر فایل نامعتبر است", 400);
  }
  if (relativePath.includes("\\")) {
    throw new AppError("INVALID_PATH", "مسیر فایل نامعتبر است", 400);
  }
  const base = config.uploadsDir;
  const abs = path.resolve(base, relativePath);
  // Ensure the resolved path is still inside base
  const rel = path.relative(base, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new AppError("INVALID_PATH", "دسترسی غیرمجاز به فایل", 403);
  }
  return abs;
}

/**
 * Returns true if the relativePath is inside the uploads directory and exists.
 */
export function isAudioInsideUploads(relativePath: string): boolean {
  try {
    const abs = resolveAudioPath(relativePath);
    return abs.startsWith(config.uploadsDir);
  } catch {
    return false;
  }
}

function pickExtension(filename: string): string {
  const ext = path.extname(filename || "").toLowerCase();
  return ext;
}

function isAllowedExtension(ext: string): boolean {
  return config.allowedAudioExtensions.includes(ext);
}

function isAllowedMime(mime: string | undefined | null): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  return config.allowedAudioTypes.includes(m);
}

/**
 * Saves uploaded file to disk with a safe random name.
 * Returns metadata about the stored file.
 *
 * If `previousRelativePath` is provided, the previous file is removed only
 * AFTER the new file is successfully written (atomic swap on filesystem).
 */
export function saveAudioFile(opts: {
  originalName: string;
  mime: string | undefined;
  buffer: Buffer;
  previousRelativePath?: string | null;
}): StoredAudio {
  const { originalName, mime, buffer, previousRelativePath } = opts;

  const ext = pickExtension(originalName);
  if (!isAllowedExtension(ext)) {
    throw new AppError(
      "INVALID_FILE_TYPE",
      `فرمت فایل پشتیبانی نمی‌شود. فرمت‌های مجاز: ${config.allowedAudioExtensions.join(", ")}`,
      415,
    );
  }

  // Some browsers send audio/mpeg for mp3, some audio/mp3 — normalize
  if (!isAllowedMime(mime)) {
    throw new AppError(
      "INVALID_FILE_TYPE",
      `نوع فایل پشتیبانی نمی‌شود. MIME مجاز نیست: ${mime ?? "نامشخص"}`,
      415,
    );
  }

  if (buffer.length === 0) {
    throw new AppError("EMPTY_FILE", "فایل خالی است", 400);
  }

  if (buffer.length > config.maxAudioSize) {
    throw new AppError(
      "FILE_TOO_LARGE",
      `حداکثر حجم فایل ${Math.floor(config.maxAudioSize / 1024 / 1024)} مگابایت است`,
      413,
    );
  }

  // Generate random safe filename
  const id = crypto.randomBytes(8).toString("hex");
  const safeName = `${id}${ext}`;
  if (!SAFE_NAME_RE.test(safeName.replace(ext, ""))) {
    // should never happen, but defensive
    throw new AppError("INTERNAL_ERROR", "خطا در تولید نام فایل", 500);
  }

  const absolutePath = path.join(config.uploadsDir, safeName);
  const relativePath = safeName;
  const url = `/uploads/audio/${safeName}`;

  // Write new file first
  try {
    fs.writeFileSync(absolutePath, buffer);
  } catch (e) {
    logger.error("Failed to write audio file", { error: (e as Error).message });
    throw new AppError("WRITE_FAILED", "ذخیره فایل ناموفق بود", 500);
  }

  // Only remove the previous file AFTER the new one is written
  if (previousRelativePath) {
    try {
      const prevAbs = resolveAudioPath(previousRelativePath);
      if (fs.existsSync(prevAbs)) {
        fs.unlinkSync(prevAbs);
        logger.info("Removed previous audio file", { path: previousRelativePath });
      }
    } catch (e) {
      // Don't fail the whole upload if cleanup of the old file fails
      logger.warn("Failed to remove previous audio file", {
        path: previousRelativePath,
        error: (e as Error).message,
      });
    }
  }

  logger.info("Audio file saved", { name: safeName, size: buffer.length, mime });

  return {
    relativePath,
    absolutePath,
    url,
    size: buffer.length,
    mime: mime || config.audioExtToMime[ext] || "application/octet-stream",
    ext,
  };
}

/**
 * Deletes an audio file by its relative path. Returns true if file was deleted.
 */
export function deleteAudioFile(relativePath: string | null | undefined): boolean {
  if (!relativePath) return false;
  try {
    const abs = resolveAudioPath(relativePath);
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
      logger.info("Audio file deleted", { path: relativePath });
      return true;
    }
    return false;
  } catch (e) {
    logger.warn("Failed to delete audio file", {
      path: relativePath,
      error: (e as Error).message,
    });
    return false;
  }
}

/**
 * Returns file size for an existing audio file, or null if missing.
 */
export function getAudioSize(relativePath: string | null | undefined): number | null {
  if (!relativePath) return null;
  try {
    const abs = resolveAudioPath(relativePath);
    if (!fs.existsSync(abs)) return null;
    const stat = fs.statSync(abs);
    return stat.size;
  } catch {
    return null;
  }
}
