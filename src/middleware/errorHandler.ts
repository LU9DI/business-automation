import type { Request, Response, NextFunction } from "express";
export function errorHandler(err:any,req:Request,res:Response,_next:NextFunction){
  const id=(req as any).requestId;
  if(res.headersSent)return;
  console.error(JSON.stringify({requestId:id,path:req.path,error:err?.message||String(err)}));
  res.status(500).json({error:"internal server error",requestId:id});
}