import jwt from "jsonwebtoken";
import crypto from "node:crypto";

export type AuthPayload = { sub: string; role?: string };

const secrets = () =>
  [process.env.JWT_SECRET, process.env.JWT_SECRET_PREVIOUS]
    .filter((v): v is string => !!v?.trim())
    .map((v) => v.trim());

export function requireJwtSecret() {
  const s = secrets()[0];
  if (!s) throw new Error("JWT_SECRET is required");
  return s;
}

export function signAccessToken(payload: AuthPayload) {
  return jwt.sign(payload, requireJwtSecret(), {
    expiresIn: 86400,
  });
}

export function verifyAccessToken(token: string) {
  let last: unknown;
  for (const s of secrets()) {
    try {
      return jwt.verify(token, s) as jwt.JwtPayload & AuthPayload;
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error("invalid token");
}

export function generateJwtSecret() {
  return crypto.randomBytes(48).toString("base64url");
}
