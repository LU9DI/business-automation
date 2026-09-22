import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; reset: number };
const buckets = new Map<string, Bucket>();
const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const apiMax = Number(process.env.RATE_LIMIT_MAX || 120);
const authMax = Number(process.env.AUTH_RATE_LIMIT_MAX || 20);

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const isAuth = req.path.startsWith("/api/auth");
  const max = isAuth ? authMax : apiMax;
  const key = `${req.ip || "unknown"}|${isAuth ? "auth" : "api"}`;
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || bucket.reset <= now) {
    bucket = { count: 0, reset: now + windowMs };
    buckets.set(key, bucket);
  }

  bucket.count++;
  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));

  if (bucket.count > max) {
    res.setHeader("Retry-After", String(Math.ceil((bucket.reset - now) / 1000)));
    return res.status(429).json({ error: "rate limit exceeded" });
  }

  if (buckets.size > 5000) {
    for (const [key, value] of buckets) if (value.reset <= now) buckets.delete(key);
  }
  next();
}