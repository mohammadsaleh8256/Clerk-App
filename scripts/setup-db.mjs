/**
 * Cross-platform database setup script.
 *
 * Why this exists:
 * - Prisma CLI reads DATABASE_URL from .env and resolves SQLite paths relative
 *   to the schema.prisma file (which is in prisma/). So a relative path like
 *   `file:./db/custom.db` would resolve to `prisma/db/custom.db` (wrong).
 * - We need an absolute path for Prisma CLI to work correctly.
 * - On Windows, paths use backslashes which Prisma doesn't accept in file URLs.
 *
 * This script:
 * 1. Computes the absolute path to <project>/db/custom.db
 * 2. Creates the db/ directory if needed
 * 3. Sets DATABASE_URL to the absolute path (with forward slashes)
 * 4. Runs `prisma generate` and `prisma db push` with this env var
 *
 * Run with: node scripts/setup-db.mjs
 */

import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

const dbDir = resolve(PROJECT_ROOT, "db");
const dbFile = resolve(dbDir, "custom.db");

// Create the db directory if it doesn't exist
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
  console.log(`[INFO] Created db directory: ${dbDir}`);
}

// Build the DATABASE_URL with forward slashes (Prisma requires /)
const dbUrl = `file:${dbFile.replace(/\\/g, "/")}`;
console.log(`[INFO] DATABASE_URL = ${dbUrl}`);

// Also update the local .env file to keep DATABASE_URL consistent for runtime
const envPath = resolve(PROJECT_ROOT, ".env");
if (existsSync(envPath)) {
  let envContent = readFileSync(envPath, "utf8");
  // Replace any existing DATABASE_URL line
  if (/^DATABASE_URL=/m.test(envContent)) {
    envContent = envContent.replace(
      /^DATABASE_URL=.*$/m,
      `DATABASE_URL=${dbUrl}`,
    );
  } else {
    envContent += `\nDATABASE_URL=${dbUrl}\n`;
  }
  writeFileSync(envPath, envContent, "utf8");
  console.log(`[INFO] Updated .env with absolute DATABASE_URL`);
}

// Run Prisma commands with the absolute DATABASE_URL
const env = { ...process.env, DATABASE_URL: dbUrl };

console.log("[INFO] Running prisma generate...");
try {
  execSync("npx prisma generate", {
    stdio: "inherit",
    env,
    cwd: PROJECT_ROOT,
  });
} catch (e) {
  console.error("[ERROR] prisma generate failed");
  process.exit(1);
}

console.log("[INFO] Running prisma db push...");
try {
  execSync("npx prisma db push", {
    stdio: "inherit",
    env,
    cwd: PROJECT_ROOT,
  });
} catch (e) {
  console.error("[ERROR] prisma db push failed");
  process.exit(1);
}

console.log("[INFO] Database setup complete!");
