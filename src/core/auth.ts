import { signAccessToken, verifyAccessToken } from "./jwt.js";

export function issueToken(subject: string) {
  return signAccessToken({ sub: subject });
}

export function verifyToken(token: string) {
  return verifyAccessToken(token);
}
