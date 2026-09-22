import type {Request,Response,NextFunction} from "express";
import {verifyToken} from "../core/auth.js";
export function requireAuth(req:Request,res:Response,next:NextFunction){const h=req.header("authorization");if(!h?.startsWith("Bearer "))return res.status(401).json({error:"unauthorized"});try{const p=verifyToken(h.slice(7));(req as any).userId=p.sub;next();}catch{return res.status(401).json({error:"invalid token"});}}
