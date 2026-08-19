import { PrismaClient } from "@prisma/client";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// In ESM there is no __dirname; derive it from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root: 4 levels up from src/server/services/prisma.ts (dev)
// or dist/server/server/services/prisma.js (prod build).
//   src/server/services/prisma.ts → src/server/services → src/server → src → <root>
//   dist/server/server/services/prisma.js → dist/server/server/services → dist/server/server → dist/server → dist → <root>
// To be safe across both layouts, walk up until we find package.json.
function findProjectRoot(start: string): string {
  let current = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Fallback: assume 4 levels up
  return path.resolve(__dirname, "../../../..");
}

const PROJECT_ROOT = findProjectRoot(__dirname);

/**
 * Resolve DATABASE_URL to an absolute path.
 *
 * Why this is needed:
 * - Prisma CLI (`prisma db push`) resolves SQLite `file:` URLs relative to the
 *   schema.prisma file location, which is `prisma/`.
 * - Prisma Client at runtime resolves the URL relative to the current working
 *   directory of the Node.js process.
 * - If the URL is a Linux absolute path (e.g. `file:/home/z/...`), it won't
 *   work on Windows or macOS.
 *
 * This function:
 * - Reads DATABASE_URL (or falls back to `<project>/db/custom.db`).
 * - Strips any leading `../` or `./` so the path is treated as project-relative.
 * - Resolves it to an absolute path from PROJECT_ROOT.
 * - Creates the parent directory if it doesn't exist.
 * - Normalizes Windows backslashes to forward slashes (Prisma requires `/`).
 * - Overrides process.env.DATABASE_URL so PrismaClient uses the absolute path.
 */
function resolveDatabaseUrl(): string {
  let url = process.env.DATABASE_URL || "";

  if (!url.startsWith("file:")) {
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

// Set the absolute URL BEFORE instantiating PrismaClient
const resolvedUrl = resolveDatabaseUrl();
process.env.DATABASE_URL = resolvedUrl;

// Use console.log here (logger isn't imported to avoid circular dependency)
// eslint-disable-next-line no-console
console.log(`[INFO] Database URL resolved to: ${resolvedUrl}`);

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
