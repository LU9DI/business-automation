import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../core/auth.js";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "unauthorized" });

  try {
    const payload = verifyToken(header.slice(7).trim());
    if (typeof payload.sub !== "string" || payload.sub.length < 1) {
      return res.status(401).json({ error: "invalid token" });
    }
    (req as Request & { userId?: string }).userId = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}