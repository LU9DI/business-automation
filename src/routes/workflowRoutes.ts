import { Router } from "express";
import { randomUUID } from "node:crypto";
import { prepareWorkflow, executeWorkflow } from "../services/workflowService.js";
import { listConnectors } from "../services/connectors.js";
import { redactedJson } from "../services/redaction.js";
import { initDb } from "../core/db.js";
import { requireAuth } from "../middleware/auth.js";

const router=Router();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IDEMPOTENCY_KEY=200;
const parseLimit=(v:unknown)=>{const n=Number(v??20);return Number.isInteger(n)&&n>=1&&n<=100?n:20;};
const parseOffset=(v:unknown)=>{const n=Number(v??0);return Number.isInteger(n)&&n>=0&&n<=100000?n:0;};

router.post("/",requireAuth,async(req,res)=>{try{const w=prepareWorkflow(req.body);const id=randomUUID();await initDb().query("INSERT INTO workflows (id,user_id,name,enabled,steps) VALUES ($1,$2,$3,$4,$5)",[id,(req as any).userId,w.name,w.enabled,JSON.stringify(w.steps)]);res.status(201).json({id,workflow:w});}catch{res.status(400).json({valid:false,error:"invalid workflow"});}});

router.get("/",requireAuth,async(req,res)=>{try{const limit=parseLimit(req.query.limit),offset=parseOffset(req.query.offset);const db=initDb();const r=await db.query("SELECT id,name,enabled,steps,created_at,updated_at FROM workflows WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3",[(req as any).userId,limit,offset]);const count=await db.query("SELECT COUNT(*)::int count FROM workflows WHERE user_id=$1",[(req as any).userId]);res.json({workflows:r.rows,pagination:{limit,offset,total:Number(count.rows[0].count),hasMore:offset+r.rows.length<Number(count.rows[0].count)}});}catch{res.status(500).json({error:"failed to load workflows"});}});

router.get("/connectors",requireAuth,(_req,res)=>res.json({connectors:listConnectors()}));

router.post("/validate",requireAuth,(req,res)=>{try{const w=prepareWorkflow(req.body);for(const step of w.steps){if(!listConnectors().includes(String(step.type||"").trim()))return res.status(400).json({valid:false,error:"unsupported connector"});}res.json({valid:true,workflow:w,connectors:listConnectors()});}catch{res.status(400).json({valid:false,error:"invalid workflow"});}});

router.post("/:id/run",requireAuth,async(req,res)=>{
  const userId=(req as any).userId;
  const db=initDb();
  const runId=randomUUID();
  let inserted=false;
  try{
    if(!UUID.test(String(req.params.id)))return res.status(400).json({error:"invalid workflow id"});
    const idempotencyKey=String(req.get("Idempotency-Key")||"").trim();
    if(!idempotencyKey||idempotencyKey.length>MAX_IDEMPOTENCY_KEY)return res.status(400).json({error:"invalid idempotency key"});
    const r=await db.query("SELECT id,name,enabled,steps FROM workflows WHERE id=$1 AND user_id=$2",[req.params.id,userId]);
    if(!r.rowCount)return res.status(404).json({error:"workflow not found"});
    const workflow=prepareWorkflow(r.rows[0]);
    if(!workflow.enabled)return res.status(409).json({error:"workflow is disabled"});

    const existing=await db.query("SELECT id,status,output,error FROM workflow_runs WHERE workflow_id=$1 AND user_id=$2 AND idempotency_key=$3",[req.params.id,userId,idempotencyKey]);
    if(existing.rowCount){
      const row=existing.rows[0];
      if(row.status==="succeeded")return res.json({runId:row.id,status:row.status,output:row.output,duplicate:true});
      if(row.status==="running"||row.status==="queued")return res.status(409).json({error:"workflow run already in progress",runId:row.id,status:row.status,duplicate:true});
      return res.status(409).json({error:"workflow run already completed with failure",runId:row.id,status:row.status,duplicate:true});
    }

    try{
      await db.query("INSERT INTO workflow_runs (id,workflow_id,user_id,status,input,started_at,idempotency_key) VALUES ($1,$2,$3,'running',$4,now(),$5)",[runId,req.params.id,userId,redactedJson(req.body||{}),idempotencyKey]);
      inserted=true;
    }catch(error:any){
      if(error?.code!=="23505")throw error;
      const raced=await db.query("SELECT id,status,output FROM workflow_runs WHERE workflow_id=$1 AND user_id=$2 AND idempotency_key=$3",[req.params.id,userId,idempotencyKey]);
      if(!raced.rowCount)return res.status(409).json({error:"workflow run could not be established"});
      const row=raced.rows[0];
      if(row.status==="succeeded")return res.json({runId:row.id,status:row.status,output:row.output,duplicate:true});
      return res.status(409).json({error:"workflow run already in progress",runId:row.id,status:row.status,duplicate:true});
    }

    const result=await executeWorkflow(workflow,req.body||{});
    await db.query("UPDATE workflow_runs SET status='succeeded',output=$1,finished_at=now() WHERE id=$2",[redactedJson(result.output),runId]);
    res.json({runId,...result});
  }catch{
    if(inserted)await db.query("UPDATE workflow_runs SET status='failed',error=$1,finished_at=now() WHERE id=$2",["execution failed",runId]).catch(()=>{});
    res.status(400).json({error:"workflow execution failed",runId:inserted?runId:undefined});
  }
});

router.get("/runs",requireAuth,async(req,res)=>{try{const limit=parseLimit(req.query.limit),offset=parseOffset(req.query.offset),db=initDb();const r=await db.query("SELECT id,workflow_id,status,input,output,error,started_at,finished_at,created_at FROM workflow_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",[(req as any).userId,limit,offset]);const count=await db.query("SELECT COUNT(*)::int count FROM workflow_runs WHERE user_id=$1",[(req as any).userId]);res.json({runs:r.rows,pagination:{limit,offset,total:Number(count.rows[0].count),hasMore:offset+r.rows.length<Number(count.rows[0].count)}});}catch{res.status(500).json({error:"failed to load runs"});}});

export default router;
