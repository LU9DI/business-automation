import { initDb } from "../core/db.js";
export async function createWorkflowVersion(workflowId:string,userId:string){
 const db=initDb(); const own=await db.query("SELECT id,name,enabled,steps FROM workflows WHERE id=$1 AND user_id=$2",[workflowId,userId]);
 if(!own.rowCount) return null;
 const v=await db.query("SELECT COALESCE(MAX(version),0)+1 version FROM workflow_versions WHERE workflow_id=$1",[workflowId]);
 const version=Number(v.rows[0].version);
 await db.query("INSERT INTO workflow_versions(id,workflow_id,version,definition,created_by) VALUES(gen_random_uuid(),$1,$2,$3,$4)",[workflowId,version,JSON.stringify(own.rows[0]),userId]);
 return version;
}
export async function recordAttempt(runId:string,attempt:number,status:string,error?:string){
 await initDb().query("INSERT INTO execution_attempts(id,run_id,attempt,status,error) VALUES(gen_random_uuid(),$1,$2,$3,$4)",[runId,attempt,status,error??null]);
}