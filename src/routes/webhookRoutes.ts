import { Router } from "express";
import { randomUUID } from "node:crypto";
import { initDb } from "../core/db.js";
import { requireAuth } from "../middleware/auth.js";
import { prepareWorkflow, executeWorkflow } from "../services/workflowService.js";
const router=Router();
router.post("/:workflowId",requireAuth,async(req,res)=>{try{const db=await initDb();const r=await db.query("SELECT id,name,enabled,steps FROM workflows WHERE id=$1 AND user_id=$2",[(req.params as any).workflowId,(req as any).userId]);if(!r.rowCount)return res.status(404).json({error:"workflow not found"});const w=prepareWorkflow(r.rows[0]);if(!w.enabled)return res.status(409).json({error:"workflow is disabled"});const runId=randomUUID();await db.query("INSERT INTO workflow_runs (id,workflow_id,user_id,status,input,started_at) VALUES ($1,$2,$3,'running',$4,now())",[runId,w as any ? r.rows[0].id : null,(req as any).userId,JSON.stringify(req.body||{})]);const result=executeWorkflow(w,req.body||{});await db.query("UPDATE workflow_runs SET status='succeeded',output=$1,finished_at=now() WHERE id=$2",[JSON.stringify(result.output),runId]);res.json({runId,...result});}catch(e){res.status(400).json({error:e instanceof Error?e.message:"webhook execution failed"});}});
export default router;