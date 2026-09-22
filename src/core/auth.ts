import jwt from "jsonwebtoken";

const getSecret = () => process.env.JWT_SECRET || "";

export function issueToken(subject: string) {
  const secret = getSecret();
  if (secret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");
  return jwt.sign({ sub: subject }, secret, { expiresIn: 604800 });
}

export function verifyToken(token: string) {
  const secret = getSecret();
  if (secret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");
  return jwt.verify(token, secret) as jwt.JwtPayload;
}