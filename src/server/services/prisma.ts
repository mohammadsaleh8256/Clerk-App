import { PrismaClient } from "@prisma/client";
import { config } from "../config/index.js";

// Ensure the database directory exists (SQLite needs the directory to exist)
import path from "node:path";
import fs from "node:fs";

const dbPath = config.databaseUrl.replace(/^file:/, "");
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.nodeEnv === "production" ? ["error", "warn"] : ["error", "warn"],
  });

if (config.nodeEnv !== "production") {
  globalForPrisma.prisma = prisma;
}
