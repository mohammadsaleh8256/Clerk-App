import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// In ESM there is no __dirname; derive it from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root: /home/z/my-project
// src/server/config/index.ts -> up 4 levels = project root
const PROJECT_ROOT = path.resolve(__dirname, "../../../..");

function ensureDir(dir: string): string {
  const abs = path.isAbsolute(dir) ? dir : path.resolve(PROJECT_ROOT, dir);
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(abs, { recursive: true });
  }
  return abs;
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  host: process.env.HOST || "0.0.0.0",
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL || `file:${path.join(PROJECT_ROOT, "db", "custom.db")}`,
  maxAudioSize: parseInt(process.env.MAX_AUDIO_SIZE || "10485760", 10),
  allowedAudioTypes: (process.env.ALLOWED_AUDIO_TYPES ||
    "audio/mpeg,audio/mp3,audio/wav,audio/wave,audio/x-wav,audio/ogg,audio/vorbis")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean),
  // Map file extensions to MIME types for response Content-Type
  audioExtToMime: {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
  } as Record<string, string>,
  allowedAudioExtensions: [".mp3", ".wav", ".ogg"] as readonly string[],
  duplicateAllowed: (process.env.DUPLICATE_ALLOWED || "false").toLowerCase() === "true",
  projectRoot: PROJECT_ROOT,
  uploadsDir: ensureDir(process.env.UPLOADS_DIR || "uploads/audio"),
  clientDistDir: path.join(PROJECT_ROOT, "dist", "client"),
} as const;

export type Config = typeof config;
