import { Router } from "express";
import { randomUUID } from "node:crypto";
import { prepareWorkflow, executeWorkflow } from "../services/workflowService.js";
import { listConnectors } from "../services/connectors.js";
import { redactedJson } from "../services/redaction.js";
import { initDb } from "../core/db.js";
import { requireAuth } from "../middleware/auth.js";
import { createWorkflowVersion, recordAttempt, ensureWorkflowVersion } from "../services/executionPolicy.js";
import { audit, enforceLimit, getEntitlement, reserveIdempotency, completeIdempotency, withEntitlementLock, assertEntitlement } from "../core/platformGovernance.js";

const router=Router();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IDEMPOTENCY_KEY=200;
const MAX_WORKFLOWS_PER_USER=100;
const MAX_RUNS_PER_DAY=500;
const MAX_CONCURRENT_RUNS=3;
const parseLimit=(v:unknown)=>{const n=Number(v??20);return Number.isInteger(n)&&n>=1&&n<=100?n:20;};
const parseOffset=(v:unknown)=>{const n=Number(v??0);return Number.isInteger(n)&&n>=0&&n<=100000?n:0;};

router.post("/",requireAuth,async(req,res)=>{
  const userId=(req as any).userId, idem=String(req.get("Idempotency-Key")||"").trim();
  try{
    if(!idem||idem.length>200)return res.status(400).json({error:"invalid idempotency key"});
    const reservation=await reserveIdempotency(userId,"workflow.create",idem);
    if(reservation?.replay)return res.status(reservation.statusCode).json(reservation.response);
    if(reservation && "inProgress" in reservation && reservation.inProgress)return res.status(409).json({error:"request already in progress"});
    const w=prepareWorkflow(req.body);
    const result=await withEntitlementLock(userId,"automations",async(client)=>{
      const count=await client.query("SELECT COUNT(*)::int count FROM workflows WHERE user_id=$1",[userId]);
      const ent=await client.query("SELECT e.enabled,e.limit_value FROM app_users u LEFT JOIN plan_entitlements e ON e.plan=u.plan AND e.feature=$2 WHERE u.id=$1 FOR UPDATE OF u",[userId,"automations"]);
      const row=ent.rows[0]; assertEntitlement({allowed:row.enabled!==false,limit:row.limit_value==null?null:Number(row.limit_value),plan:""}, "automations",Number(count.rows[0].count));
      const id=randomUUID();
      await client.query("INSERT INTO workflows (id,user_id,name,enabled,steps) VALUES ($1,$2,$3,$4,$5)",[id,userId,w.name,w.enabled,JSON.stringify(w.steps)]);
      await client.query("INSERT INTO workflow_versions(id,workflow_id,version,definition,created_by) VALUES($1,$2,1,$3,$4)",[randomUUID(),id,JSON.stringify({id,name:w.name,enabled:w.enabled,steps:w.steps}),userId]);
      return {id,workflow:w,workflowVersion:1};
    });
    await completeIdempotency(userId,"workflow.create",idem,201,result); return res.status(201).json(result);
  }catch(error:any){if(error?.code==="ENTITLEMENT_LIMIT")return res.status(429).json({error:"workflow plan limit reached",limit:error.limit});return res.status(400).json({valid:false,error:"invalid workflow"});}
});

router.get("/",requireAuth,async(req,res)=>{try{const limit=parseLimit(req.query.limit),offset=parseOffset(req.query.offset);const db=initDb();const r=await db.query("SELECT id,name,enabled,steps,created_at,updated_at FROM workflows WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3",[(req as any).userId,limit,offset]);const count=await db.query("SELECT COUNT(*)::int count FROM workflows WHERE user_id=$1",[(req as any).userId]);res.json({workflows:r.rows,pagination:{limit,offset,total:Number(count.rows[0].count),hasMore:offset+r.rows.length<Number(count.rows[0].count)}});}catch{res.status(500).json({error:"failed to load workflows"});}});

router.post("/:id/version",requireAuth,async(req,res)=>{
  if(!UUID.test(String(req.params.id)))return res.status(400).json({error:"invalid workflow id"});
  const db=initDb();
  try{
    await db.query("BEGIN");
    const version=await createWorkflowVersion(String(req.params.id),(req as any).userId,db);
    if(version==null){await db.query("ROLLBACK");return res.status(404).json({error:"workflow not found"});}
    await db.query("COMMIT");
    res.status(201).json({workflowId:req.params.id,version});
  }catch{await db.query("ROLLBACK").catch(()=>{});res.status(500).json({error:"failed to create workflow version"});}
});
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
    let workflow=prepareWorkflow(r.rows[0]);
    const concurrent=await db.query("SELECT COUNT(*)::int count FROM workflow_runs WHERE user_id=$1 AND status IN ('running','queued')",[userId]);
    if(Number(concurrent.rows[0].count)>=MAX_CONCURRENT_RUNS)return res.status(429).json({error:"concurrency limit reached",limit:MAX_CONCURRENT_RUNS});
    const daily=await db.query("SELECT COUNT(*)::int count FROM workflow_runs WHERE user_id=$1 AND created_at >= now()-interval '24 hours'",[userId]);
    if(Number(daily.rows[0].count)>=MAX_RUNS_PER_DAY)return res.status(429).json({error:"daily workflow run limit reached",limit:MAX_RUNS_PER_DAY});
    if(!workflow.enabled)return res.status(409).json({error:"workflow is disabled"});

    const existing=await db.query("SELECT id,status,output,error FROM workflow_runs WHERE workflow_id=$1 AND user_id=$2 AND idempotency_key=$3",[req.params.id,userId,idempotencyKey]);
    if(existing.rowCount){
      const row=existing.rows[0];
      if(row.status==="succeeded")return res.json({runId:row.id,status:row.status,output:row.output,duplicate:true});
      if(row.status==="running"||row.status==="queued")return res.status(409).json({error:"workflow run already in progress",runId:row.id,status:row.status,duplicate:true});
      return res.status(409).json({error:"workflow run already completed with failure",runId:row.id,status:row.status,duplicate:true});
    }

    try{
      await db.query("BEGIN");
      const version=await ensureWorkflowVersion(String(req.params.id),userId,db);
      if(!version){await db.query("ROLLBACK");return res.status(404).json({error:"workflow not found"});}
      const snapshot=typeof version.definition==="string"?JSON.parse(version.definition):version.definition;
      await db.query("INSERT INTO workflow_runs (id,workflow_id,workflow_version_id,user_id,status,input,started_at,idempotency_key) VALUES ($1,$2,$3,$4,'running',$5,now(),$6)",[runId,req.params.id,version.id,userId,redactedJson(req.body||{}),idempotencyKey]);
      await db.query("COMMIT");
      inserted=true;
      r.rows[0]={...r.rows[0],...snapshot};
      workflow=prepareWorkflow(snapshot);
    }catch(error:any){
      if(error?.code!=="23505"){await db.query("ROLLBACK").catch(()=>{});throw error;}
      await db.query("ROLLBACK").catch(()=>{});
      const raced=await db.query("SELECT id,status,output FROM workflow_runs WHERE workflow_id=$1 AND user_id=$2 AND idempotency_key=$3",[req.params.id,userId,idempotencyKey]);
      if(!raced.rowCount)return res.status(409).json({error:"workflow run could not be established"});
      const row=raced.rows[0];
      if(row.status==="succeeded")return res.json({runId:row.id,status:row.status,output:row.output,duplicate:true});
      return res.status(409).json({error:"workflow run already in progress",runId:row.id,status:row.status,duplicate:true});
    }

    await recordAttempt(runId,1,"running",undefined,(await db.query("SELECT workflow_version_id FROM workflow_runs WHERE id=$1",[runId])).rows[0]?.workflow_version_id);
    const result=await executeWorkflow(workflow,req.body||{});
    await db.query("UPDATE workflow_runs SET status='succeeded',output=$1,finished_at=now() WHERE id=$2",[redactedJson(result.output),runId]);
    await recordAttempt(runId,1,"succeeded",undefined,(await db.query("SELECT workflow_version_id FROM workflow_runs WHERE id=$1",[runId])).rows[0]?.workflow_version_id);
    res.json({runId,...result});
  }catch{
    if(inserted){const versionId=(await db.query("SELECT workflow_version_id FROM workflow_runs WHERE id=$1",[runId])).rows[0]?.workflow_version_id;await db.query("UPDATE workflow_runs SET status='failed',error=$1,finished_at=now() WHERE id=$2",["execution failed",runId]).catch(()=>{});await recordAttempt(runId,1,"failed","execution failed",versionId).catch(()=>{});}
    res.status(400).json({error:"workflow execution failed",runId:inserted?runId:undefined});
  }
});

router.post("/runs/:runId/retry",requireAuth,async(req,res)=>{const runId=String(req.params.runId);if(!UUID.test(runId))return res.status(400).json({error:"invalid run id"});const db=initDb();let attempt=0;try{const r=await db.query("SELECT r.*,v.definition AS version_definition,v.version AS workflow_version FROM workflow_runs r JOIN workflows w ON w.id=r.workflow_id LEFT JOIN workflow_versions v ON v.id=r.workflow_version_id WHERE r.id=$1 AND r.user_id=$2",[runId,(req as any).userId]);if(!r.rowCount)return res.status(404).json({error:"run not found"});const row=r.rows[0];if(row.status!=="failed")return res.status(409).json({error:"only failed runs can be retried"});const attempts=await db.query("SELECT COUNT(*)::int count FROM execution_attempts WHERE run_id=$1",[runId]);attempt=Number(attempts.rows[0].count)+1;if(attempt>3)return res.status(429).json({error:"retry limit reached",limit:3});const snapshot=row.version_definition ? (typeof row.version_definition==="string"?JSON.parse(row.version_definition):row.version_definition) : {name:row.name,enabled:row.enabled,steps:row.steps};const workflow=prepareWorkflow(snapshot);await recordAttempt(runId,attempt,"running",undefined,row.workflow_version_id);const result=await executeWorkflow(workflow,req.body||{});await db.query("UPDATE workflow_runs SET status='succeeded',output=$1,error=NULL,finished_at=now() WHERE id=$2",[redactedJson(result.output),runId]);await recordAttempt(runId,attempt,"succeeded",undefined,row.workflow_version_id);return res.json({runId,attempt,...result});}catch{if(attempt>0)await recordAttempt(runId,attempt,"failed","retry execution failed").catch(()=>{});return res.status(400).json({error:"workflow retry failed",runId,attempt:attempt||undefined});}});
router.get("/runs",requireAuth,async(req,res)=>{try{const limit=parseLimit(req.query.limit),offset=parseOffset(req.query.offset),db=initDb();const r=await db.query("SELECT id,workflow_id,workflow_version_id,status,input,output,error,started_at,finished_at,created_at FROM workflow_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",[(req as any).userId,limit,offset]);const count=await db.query("SELECT COUNT(*)::int count FROM workflow_runs WHERE user_id=$1",[(req as any).userId]);res.json({runs:r.rows,pagination:{limit,offset,total:Number(count.rows[0].count),hasMore:offset+r.rows.length<Number(count.rows[0].count)}});}catch{res.status(500).json({error:"failed to load runs"});}});

router.patch("/:id",requireAuth,async(req,res)=>{
  if(!UUID.test(String(req.params.id)))return res.status(400).json({error:"invalid workflow id"});
  const db=initDb();
  try{
    const w=prepareWorkflow(req.body);
    await db.query("BEGIN");
    const own=await db.query("SELECT id,name,enabled,steps,created_at,updated_at FROM workflows WHERE id=$1 AND user_id=$2 FOR UPDATE",[req.params.id,(req as any).userId]);
    if(!own.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"workflow not found"});}
    const active=await db.query("SELECT COUNT(*)::int count FROM workflow_runs WHERE workflow_id=$1 AND user_id=$2 AND status IN ('running','queued')",[req.params.id,(req as any).userId]);
    if(Number(active.rows[0].count)>0){await db.query("ROLLBACK");return res.status(409).json({error:"workflow has active executions"});}
    const r=await db.query("UPDATE workflows SET name=$1,enabled=$2,steps=$3,updated_at=now() WHERE id=$4 AND user_id=$5 RETURNING id,name,enabled,steps,created_at,updated_at",[w.name,w.enabled,JSON.stringify(w.steps),req.params.id,(req as any).userId]);
    const version=await createWorkflowVersion(String(req.params.id),(req as any).userId,db);
    await db.query("COMMIT");
    res.json({workflow:r.rows[0],workflowVersion:version});
  }catch{await db.query("ROLLBACK").catch(()=>{});res.status(400).json({error:"invalid workflow"});}
});
router.delete("/:id",requireAuth,async(req,res)=>{try{if(!UUID.test(String(req.params.id)))return res.status(400).json({error:"invalid workflow id"});const r=await initDb().query("DELETE FROM workflows WHERE id=$1 AND user_id=$2",[req.params.id,(req as any).userId]);if(!r.rowCount)return res.status(404).json({error:"workflow not found"});res.status(204).end();}catch{res.status(500).json({error:"failed to delete workflow"});}});
router.get("/:id/analytics",requireAuth,async(req,res)=>{try{const db=initDb(),id=String(req.params.id),uid=(req as any).userId;const p=["7d","30d","90d","12m","all"].includes(String(req.query.period))?String(req.query.period):"30d";const cut=p==="7d"?"now()-interval '7 days'":p==="90d"?"now()-interval '90 days'":p==="12m"?"now()-interval '12 months'":p==="all"?"to_timestamp(0)":"now()-interval '30 days'";const bucket=p==="12m"||p==="all"?"month":"day";const w=await db.query("SELECT id,name,enabled FROM workflows WHERE id=$1 AND user_id=$2",[id,uid]);if(!w.rowCount)return res.status(404).json({error:"workflow not found"});const s=await db.query("SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='succeeded')::int succeeded,COUNT(*) FILTER(WHERE status='failed')::int failed,COUNT(*) FILTER(WHERE status IN ('running','queued'))::int active,MAX(created_at) last_run FROM workflow_runs WHERE workflow_id=$1 AND user_id=$2 AND created_at >= "+cut,[id,uid]);const trend=await db.query("SELECT date_trunc('"+bucket+"',created_at) bucket,COUNT(*)::int total,COUNT(*) FILTER(WHERE status='succeeded')::int succeeded,COUNT(*) FILTER(WHERE status='failed')::int failed FROM workflow_runs WHERE workflow_id=$1 AND user_id=$2 AND created_at >= "+cut+" GROUP BY 1 ORDER BY 1",[id,uid]);const recent=await db.query("SELECT id,workflow_version_id,status,started_at,finished_at,created_at,error FROM workflow_runs WHERE workflow_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 12",[id,uid]);res.json({workflow:w.rows[0],period:p,analytics:{...s.rows[0],trend:trend.rows,recent:recent.rows}})}catch{res.status(500).json({error:"failed to load analytics"})}});

router.get("/:id/runs/:runId",requireAuth,async(req,res)=>{try{const id=String(req.params.id),runId=String(req.params.runId);if(!UUID.test(id)||!UUID.test(runId))return res.status(400).json({error:"invalid workflow or run id"});const r=await initDb().query("SELECT r.id,r.workflow_id,r.workflow_version_id,r.status,r.input,r.output,r.error,r.started_at,r.finished_at,r.created_at,r.idempotency_key FROM workflow_runs r JOIN workflows w ON w.id=r.workflow_id WHERE r.id=$1 AND r.workflow_id=$2 AND r.user_id=$3",[runId,id,(req as any).userId]);if(!r.rowCount)return res.status(404).json({error:"run not found"});res.json({run:r.rows[0]});}catch{res.status(500).json({error:"failed to load workflow run"})}});

export default router;
