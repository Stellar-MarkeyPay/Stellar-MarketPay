/**
 * src/utils/logger.ts
 * Structured logging with request IDs and context
 */
import pino from "pino";
import { v4 as uuidv4 } from "uuid";
import type { Request, Response, NextFunction } from "express";

// Configure logger based on environment
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env.NODE_ENV === "production"
    ? {
        // JSON format for production
        serializers: pino.stdSerializers,
      }
    : {
        // Pretty print for development
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }),
});

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return uuidv4();
}

/**
 * Create a child logger with request context
 */
export function createRequestLogger(req: Request): pino.Logger {
  const requestId = req.requestId || generateRequestId();
  req.requestId = requestId;

  return logger.child({
    requestId,
    method: req.method,
    path: req.path,
    userId: req.user?.publicKey,
    userAgent: req.get("User-Agent"),
    ip: req.ip,
  });
}

/**
 * Middleware to add request ID and logger to request object
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = generateRequestId();
  req.logger = createRequestLogger(req);

  // Log request start
  req.logger.info({
    msg: "Request started",
    query: req.query,
    body:
      req.method === "POST" || req.method === "PUT" || req.method === "PATCH"
        ? sanitizeBody(req.body)
        : undefined,
  });

  // Track response time
  const startTime = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    req.logger?.info({
      msg: "Request completed",
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}

/**
 * Sanitize request body for logging (remove sensitive fields)
 */
function sanitizeBody(body: any): any {
  if (!body || typeof body !== "object") return body;

  const sensitiveFields = ["password", "token", "secret", "key", "credential"];
  const sanitized = { ...body };

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = "[REDACTED]";
    }
  }

  return sanitized;
}

/**
 * Log error with full context and stack trace
 */
export function logError(
  loggerInstance: pino.Logger,
  error: any,
  context: Record<string, any> = {}
): void {
  loggerInstance.error({
    msg: error?.message || "Unknown error",
    error: {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
    },
    ...context,
  });
}

/**
 * Create service logger with service name context
 */
export function createServiceLogger(serviceName: string): pino.Logger {
  return logger.child({ service: serviceName });
}
