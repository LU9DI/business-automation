import { randomUUID } from "node:crypto";
import { initDb } from "../core/db.js";

const WORKFLOW_LOCK_NAMESPACE = "business-automation:workflow";

export async function lockWorkflowShared(client:any,workflowId:string){
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtext($1),hashtext($2))",[WORKFLOW_LOCK_NAMESPACE,workflowId]);
}

export async function lockWorkflowExclusive(client:any,workflowId:string){
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",[WORKFLOW_LOCK_NAMESPACE,workflowId]);
}

export async function createWorkflowVersion(workflowId:string,userId:string,client?:any){
 const db=client??initDb();
 await lockWorkflowExclusive(db,workflowId);
 const own=await db.query("SELECT id,name,enabled,steps FROM workflows WHERE id=$1 AND user_id=$2",[workflowId,userId]);
 if(!own.rowCount) return null;
 const v=await db.query("SELECT COALESCE(MAX(version),0)+1 version FROM workflow_versions WHERE workflow_id=$1",[workflowId]);
 const version=Number(v.rows[0].version);
 await db.query("INSERT INTO workflow_versions(id,workflow_id,version,definition,created_by) VALUES($1,$2,$3,$4,$5)",[randomUUID(),workflowId,version,JSON.stringify(own.rows[0]),userId]);
 return version;
}

export async function recordAttempt(runId:string,attempt:number,status:string,error?:string,workflowVersionId?:string,client?:any){
 const db=client??initDb();
 await db.query("INSERT INTO execution_attempts(id,run_id,attempt,status,error,workflow_version_id) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),runId,attempt,status,error??null,workflowVersionId??null]);
}

export async function ensureWorkflowVersion(workflowId:string,userId:string,client?:any){
 // Advisory locking deliberately serializes execution-vs-edit at the application resource
 // level. Shared execution locks may coexist, but once an exclusive edit request is waiting,
 // later shared requests are arbitrated by PostgreSQL's general lock manager instead of
 // entering a tuple MultiXact that can repeatedly overtake the exclusive waiter.
 const db=client??initDb();
 await lockWorkflowShared(db,workflowId);
 const own=await db.query("SELECT id,name,enabled,steps FROM workflows WHERE id=$1 AND user_id=$2 FOR SHARE",[workflowId,userId]);
 if(!own.rowCount) return null;
 const latest=await db.query("SELECT id,version,definition FROM workflow_versions WHERE workflow_id=$1 ORDER BY version DESC LIMIT 1",[workflowId]);
 if(latest.rowCount) return latest.rows[0];
 const id=randomUUID();
 await db.query("INSERT INTO workflow_versions(id,workflow_id,version,definition,created_by) VALUES($1,$2,1,$3,$4)",[id,workflowId,JSON.stringify(own.rows[0]),userId]);
 return {id,version:1,definition:own.rows[0]};
}