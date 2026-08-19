export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function toErrorResponse(e: unknown): { code: string; message: string; details?: unknown } {
  if (isAppError(e)) {
    return { code: e.code, message: e.message, details: e.details };
  }
  if (e instanceof Error) {
    return { code: "INTERNAL_ERROR", message: e.message };
  }
  return { code: "INTERNAL_ERROR", message: "خطای ناشناخته" };
}
