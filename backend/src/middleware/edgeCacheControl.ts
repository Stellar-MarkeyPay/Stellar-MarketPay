import type { Request, Response, NextFunction } from "express";
// @ts-ignore
import { CONTENT_TYPES, cacheControlFor } from "../services/cdn/cacheStrategy";

export function edgeCacheControl(
  type: string,
  { surrogateKeys }: { surrogateKeys?: string[] | ((req: Request) => string[]) } = {}
) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", cacheControlFor(type));

    const keys = typeof surrogateKeys === "function" ? surrogateKeys(req) : surrogateKeys;
    if (keys && keys.length) {
      res.set("Surrogate-Key", keys.join(" "));
      res.set("Cache-Tag", keys.join(","));
    }
    next();
  };
}

export { CONTENT_TYPES };
