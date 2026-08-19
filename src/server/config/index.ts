import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// ============================================================================
// Load .env file FIRST, before any config values are read.
// We load it explicitly because:
//  - Node's `tsx` does NOT auto-load .env by default in older versions.
//  - Prisma CLI loads .env itself, but Prisma Client (runtime) does not.
//  - We need consistent env vars across config.ts, prisma.ts, and PrismaClient.
//
// dotenv.config() silently ignores missing files, so this is safe.
// ============================================================================
dotenv.config();

// ============================================================================
// In ESM there is no __dirname; derive it from import.meta.url
// ============================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Find project root by walking up looking for package.json.
//
// Why we don't use a fixed number of `..` segments:
//  - In dev mode (tsx), this file is at:  <root>/src/server/config/index.ts
//  - In prod mode (built), this file is at: <root>/dist/server/server/config/index.js
//  - These have different depths, so a fixed `../../../..` would be wrong in one of them.
// ============================================================================
function findProjectRoot(start: string): string {
  let current = start;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Fallback: assume 3 levels up from src/server/config (dev mode)
  return path.resolve(__dirname, "../../..");
}

const PROJECT_ROOT = findProjectRoot(__dirname);

// ============================================================================
// Resolve DATABASE_URL to an absolute path.
//
// Why:
//  - Prisma CLI resolves SQLite `file:` URLs relative to schema.prisma.
//  - Prisma Client (runtime) resolves relative to CWD.
//  - When CWD doesn't match project root, the wrong database file is opened.
//  - When the URL is a Linux absolute path (e.g. `file:/home/z/...`), it
//    creates files like `C:\home\z\...` on Windows — wrong location.
//
// This function:
//  1. Reads DATABASE_URL from env (already loaded by dotenv above).
//  2. Strips leading `../` and `./` segments so the path resolves from PROJECT_ROOT.
//  3. Resolves to absolute path from PROJECT_ROOT if not already absolute.
//  4. Creates the parent directory if it doesn't exist.
//  5. Normalizes Windows backslashes to forward slashes (Prisma requires `/`).
//  6. Sets process.env.DATABASE_URL so PrismaClient uses the resolved URL.
// ============================================================================
function resolveDatabaseUrl(): string {
  let url = process.env.DATABASE_URL || "";

  // Fallback to default location if not set
  if (!url || !url.startsWith("file:")) {
    url = `file:${path.join(PROJECT_ROOT, "db", "custom.db")}`;
  }

  // Extract path part (after "file:")
  let p = url.slice("file:".length).trim();

  // Strip leading "../" and "./ segments so the path resolves from PROJECT_ROOT.
  // (Prisma CLI needs "../db/..." relative to schema.prisma, but at runtime we want
  // "<project>/db/..." regardless of cwd.)
  p = p.replace(/^(\.\.[\\/])+/, "").replace(/^(\.[\\/])+/, "");

  // Resolve to absolute path from PROJECT_ROOT
  if (!path.isAbsolute(p)) {
    p = path.resolve(PROJECT_ROOT, p);
  }

  // Ensure the database directory exists
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Normalize backslashes to forward slashes for Prisma compatibility
  // (Windows paths use \, but Prisma requires / in file URLs)
  const normalized = p.replace(/\\/g, "/");

  return `file:${normalized}`;
}

const resolvedDatabaseUrl = resolveDatabaseUrl();
// Override process.env so PrismaClient picks up the absolute URL
process.env.DATABASE_URL = resolvedDatabaseUrl;

// eslint-disable-next-line no-console
console.log(`[INFO] Project root: ${PROJECT_ROOT}`);
// eslint-disable-next-line no-console
console.log(`[INFO] Database URL: ${resolvedDatabaseUrl}`);

function ensureDir(dir: string): string {
  const abs = path.isAbsolute(dir) ? dir : path.resolve(PROJECT_ROOT, dir);
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(abs, { recursive: true });
  }
  return abs;
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  // Default to 0.0.0.0 so the server is reachable on all network interfaces
  // (loopback 127.0.0.1, LAN IP, etc.). This is critical because:
  //   - Vite dev proxy connects to http://localhost:3000 (which is 127.0.0.1)
  //   - TV clients connect via the laptop's LAN IP (e.g. http://192.168.1.50:3000)
  //   - If HOST is set to a specific IP (e.g. 192.168.1.109), the server only
  //     listens on that interface and 127.0.0.1 will be refused (ECONNREFUSED).
  //   - Setting HOST=0.0.0.0 makes the server listen on ALL interfaces.
  // If the user set HOST to a specific IP in .env, we OVERRIDE it to 0.0.0.0
  // and log a warning, because a specific IP breaks the Vite dev proxy.
  host: (() => {
    const envHost = process.env.HOST;
    if (envHost && envHost !== "0.0.0.0" && envHost !== "localhost" && envHost !== "127.0.0.1") {
      // eslint-disable-next-line no-console
      console.log(`[WARN] HOST='${envHost}' in .env — overriding to '0.0.0.0' to ensure Vite dev proxy works correctly.`);
      return "0.0.0.0";
    }
    return "0.0.0.0";
  })(),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: resolvedDatabaseUrl,
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
