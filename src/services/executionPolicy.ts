import { randomUUID } from "node:crypto";
import { initDb } from "../core/db.js";

export async function createWorkflowVersion(workflowId:string,userId:string,client?:any){
 const db=client??initDb();
 const own=await db.query("SELECT id,name,enabled,steps FROM workflows WHERE id=$1 AND user_id=$2 FOR UPDATE",[workflowId,userId]);
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
 // Execution takes a shared row lock: concurrent executions may capture the same
 // committed version in parallel, while an edit's FOR UPDATE waits for all readers.
 // Keep the exclusive lock in createWorkflowVersion/PATCH so execution × edit remains serialized.
 const db=client??initDb();
 const own=await db.query("SELECT id,name,enabled,steps FROM workflows WHERE id=$1 AND user_id=$2 FOR SHARE",[workflowId,userId]);
 if(!own.rowCount) return null;
 const latest=await db.query("SELECT id,version,definition FROM workflow_versions WHERE workflow_id=$1 ORDER BY version DESC LIMIT 1",[workflowId]);
 if(latest.rowCount) return latest.rows[0];
 const id=randomUUID();
 await db.query("INSERT INTO workflow_versions(id,workflow_id,version,definition,created_by) VALUES($1,$2,1,$3,$4)",[id,workflowId,JSON.stringify(own.rows[0]),userId]);
 return {id,version:1,definition:own.rows[0]};
}