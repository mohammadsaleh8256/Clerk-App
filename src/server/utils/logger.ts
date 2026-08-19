type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

const COLORS: Record<LogLevel, string> = {
  INFO: "\x1b[36m",   // cyan
  WARN: "\x1b[33m",   // yellow
  ERROR: "\x1b[31m",  // red
  DEBUG: "\x1b[90m",  // gray
};
const RESET = "\x1b[0m";

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, msg: string, meta?: unknown): void {
  const metaStr = meta !== undefined ? ` ${JSON.stringify(meta)}` : "";
  // eslint-disable-next-line no-console
  console.log(`[${COLORS[level]}${level}${RESET}] ${timestamp()} ${msg}${metaStr}`);
}

export const logger = {
  info: (msg: string, meta?: unknown) => log("INFO", msg, meta),
  warn: (msg: string, meta?: unknown) => log("WARN", msg, meta),
  error: (msg: string, meta?: unknown) => log("ERROR", msg, meta),
  debug: (msg: string, meta?: unknown) => {
    if (process.env.NODE_ENV !== "production") {
      log("DEBUG", msg, meta);
    }
  },
};
