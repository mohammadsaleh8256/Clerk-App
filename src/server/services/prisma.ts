import { PrismaClient } from "@prisma/client";
import { config } from "../config/index.js";

// Database URL is already resolved and set in process.env by config.ts
// (which loads .env via dotenv and resolves the path to an absolute,
// cross-platform-safe form). PrismaClient will read process.env.DATABASE_URL.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (config.nodeEnv !== "production") {
  globalForPrisma.prisma = prisma;
}

// Re-export config.databaseUrl for convenience
export const databaseUrl = config.databaseUrl;
