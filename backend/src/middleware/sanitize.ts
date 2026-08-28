import xss from "xss";
import validator from "validator";
import type { Request, Response, NextFunction } from "express";

const SQL_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|DECLARE)\b)/gi,
  /(--|\/\*|\*\/)/g,
  /(\bOR\b.*=.*|1=1|'=')/gi,
];

const XSS_OPTIONS = {
  whiteList: {}, // No tags allowed
  stripIgnoreTag: true, // Remove all tags
  stripIgnoreTagBody: ["script", "style"], // Remove script and style content
};

export function sanitizeString(
  value: any,
  options: { strict?: boolean; allowBasicMarkdown?: boolean } = {}
): any {
  if (typeof value !== "string") return value;

  let sanitized = validator.unescape(value).normalize("NFKC");
  sanitized = xss(sanitized, XSS_OPTIONS);
  sanitized = validator.unescape(sanitized).normalize("NFKC");
  sanitized = xss(sanitized, XSS_OPTIONS);

  sanitized = sanitized.replace(/[<>]/g, "");

  if (options.strict) {
    for (const pattern of SQL_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(sanitized)) {
        console.warn("[sanitize] Suspicious SQL pattern detected:", sanitized.substring(0, 100));
      }
    }
  }

  return sanitized.trim();
}

export function sanitizeObject(
  obj: any,
  options: any = {},
  visited = new WeakSet(),
  depth = 0
): any {
  const MAX_DEPTH = 20;
  if (depth > MAX_DEPTH) {
    throw new Error("Input nesting depth exceeds limit");
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    return sanitizeString(obj, options);
  }

  if (Array.isArray(obj)) {
    if (visited.has(obj)) {
      return [];
    }
    visited.add(obj);
    return obj.map((item) => sanitizeObject(item, options, visited, depth + 1));
  }

  if (typeof obj === "object") {
    if (visited.has(obj)) {
      return {};
    }
    visited.add(obj);

    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      const sanitizedKey = sanitizeString(key, { strict: false });

      if (
        sanitizedKey === "__proto__" ||
        sanitizedKey === "constructor" ||
        sanitizedKey === "prototype"
      ) {
        console.warn("[sanitize] Blocked dangerous key:", sanitizedKey);
        continue;
      }

      sanitized[sanitizedKey] = sanitizeObject(value, options, visited, depth + 1);
    }
    return sanitized;
  }

  return obj;
}

export function sanitizeMiddleware(
  options: { body?: boolean; query?: boolean; params?: boolean; strict?: boolean } = {}
) {
  const { body = true, query = true, params = true, strict = false } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (body && req.body) {
        req.body = sanitizeObject(req.body, { strict });
      }

      if (query && req.query) {
        const sanitized = sanitizeObject(req.query, { strict });
        try {
          req.query = sanitized;
        } catch (e) {
          Object.defineProperty(req, "query", {
            value: sanitized,
            configurable: true,
            enumerable: true,
            writable: true,
          });
        }
      }

      if (params && req.params) {
        const sanitized = sanitizeObject(req.params, { strict });
        try {
          req.params = sanitized;
        } catch (e) {
          Object.defineProperty(req, "params", {
            value: sanitized,
            configurable: true,
            enumerable: true,
            writable: true,
          });
        }
      }

      next();
    } catch (error) {
      console.error("[sanitize] Error during sanitization:", error);
      res.status(400).json({
        success: false,
        error: "Invalid input data",
      });
    }
  };
}
