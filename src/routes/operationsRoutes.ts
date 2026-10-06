import { Router } from "express";
import { initDb } from "../core/db.js";
import { requireAuth } from "../middleware/auth.js";
const router=Router();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get("/:id/operations",requireAuth,async(req,res)=>{
  try{
    const id=String(req.params.id),uid=(req as any).userId;
    if(!UUID.test(id)) return res.status(400).json({error:"invalid workflow id"});
    const db=initDb();
    const own=await db.query("SELECT id,name,enabled FROM workflows WHERE id=$1 AND user_id=$2",[id,uid]);
    if(!own.rowCount)return res.status(404).json({error:"workflow not found"});
    const s=await db.query(`
      SELECT COUNT(*)::int total,
        COUNT(*) FILTER(WHERE status='succeeded')::int succeeded,
        COUNT(*) FILTER(WHERE status='failed')::int failed,
        COUNT(*) FILTER(WHERE status IN ('running','queued'))::int active,
        COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at-started_at))*1000) FILTER(WHERE finished_at IS NOT NULL),0)::float avg_duration_ms,
        COALESCE(MAX(EXTRACT(EPOCH FROM (finished_at-started_at))*1000) FILTER(WHERE finished_at IS NOT NULL),0)::float max_duration_ms,
        MAX(finished_at) last_finished
      FROM workflow_runs WHERE workflow_id=$1 AND user_id=$2
    `,[id,uid]);
    const failures=await db.query(`
      SELECT COALESCE(NULLIF(error,''),'execution failed') error,COUNT(*)::int count
      FROM workflow_runs WHERE workflow_id=$1 AND user_id=$2 AND status='failed'
      GROUP BY 1 ORDER BY count DESC LIMIT 10
    `,[id,uid]);
    const attempts=await db.query(`
      SELECT COUNT(*)::int attempts,
        COUNT(*) FILTER(WHERE status='succeeded')::int successful_attempts,
        COUNT(*) FILTER(WHERE status='failed')::int failed_attempts
      FROM execution_attempts ea JOIN workflow_runs wr ON wr.id=ea.run_id
      WHERE wr.workflow_id=$1 AND wr.user_id=$2
    `,[id,uid]);
    const a=s.rows[0], total=Number(a.total||0), failed=Number(a.failed||0);
    const successRate=total?Math.round(Number(a.succeeded||0)/total*10000)/100:0;
    const failureRate=total?Math.round(failed/total*10000)/100:0;
    const health=failed>=3?"critical":failed>0?"degraded":total===0?"unknown":"healthy";
    res.json({workflow:own.rows[0],operations:{
      health,totalRuns:total,succeededRuns:Number(a.succeeded||0),failedRuns:failed,activeRuns:Number(a.active||0),
      successRate,failureRate,avgDurationMs:Math.round(Number(a.avg_duration_ms||0)),maxDurationMs:Math.round(Number(a.max_duration_ms||0)),
      lastFinished:a.last_finished,retryAttempts:Number(attempts.rows[0]?.attempts||0),
      successfulAttempts:Number(attempts.rows[0]?.successful_attempts||0),failedAttempts:Number(attempts.rows[0]?.failed_attempts||0),
      topFailureReasons:failures.rows
    },definition:"Operational metrics describe recorded workflow executions and do not imply external business outcomes."});
  }catch{res.status(500).json({error:"failed to load workflow operations"});}
});
export default router;
