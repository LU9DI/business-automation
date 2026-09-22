import jwt from "jsonwebtoken";
const secret=()=>process.env.JWT_SECRET||"";
export function issueToken(subject:string){if(secret().length<32)throw new Error("JWT_SECRET must be at least 32 characters");return jwt.sign({sub:subject},secret(),{expiresIn:process.env.JWT_EXPIRES||"7d"});}
export function verifyToken(token:string){if(!secret())throw new Error("JWT_SECRET is not configured");return jwt.verify(token,secret()) as jwt.JwtPayload;}
