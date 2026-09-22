import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
export function requestId(req:Request,res:Response,next:NextFunction){
  const id=req.header("x-request-id")?.slice(0,128)||randomUUID();
  (req as any).requestId=id; res.setHeader("X-Request-Id",id); next();
}