import type { Request, Response, NextFunction } from "express";

type Bucket={count:number;reset:number};
const buckets=new Map<string,Bucket>();
const windowMs=Number(process.env.RATE_LIMIT_WINDOW_MS||60_000);
const max=Number(process.env.RATE_LIMIT_MAX||120);

export function rateLimit(req:Request,res:Response,next:NextFunction){
  const key=(req.ip||"unknown")+"|"+(req.path.startsWith("/api/auth")?"auth":"api");
  const now=Date.now(); let b=buckets.get(key);
  if(!b||b.reset<=now){b={count:0,reset:now+windowMs};buckets.set(key,b);}
  b.count++;
  res.setHeader("X-RateLimit-Limit",String(max));
  res.setHeader("X-RateLimit-Remaining",String(Math.max(0,max-b.count)));
  if(b.count>max){res.setHeader("Retry-After",String(Math.ceil((b.reset-now)/1000)));return res.status(429).json({error:"rate limit exceeded"});}
  if(buckets.size>5000){for(const [k,v] of buckets)if(v.reset<=now)buckets.delete(k);}
  next();
}