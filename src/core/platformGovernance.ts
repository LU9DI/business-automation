import { randomUUID } from "node:crypto";
import { initDb } from "./db.js";

export type Entitlement = { allowed: boolean; limit: number | null; plan: string };
export class EntitlementError extends Error {
  readonly code = "ENTITLEMENT_LIMIT";
  constructor(public readonly feature: string, public readonly limit: number | null, message: string) { super(message); }
}
export function assertEntitlement(entitlement: Entitlement, feature: string, current: number): Entitlement {
  if (!entitlement.allowed) throw new EntitlementError(feature, entitlement.limit, `feature disabled: ${feature}`);
  if (entitlement.limit !== null && current >= entitlement.limit) throw new EntitlementError(feature, entitlement.limit, `limit reached: ${feature}`);
  return entitlement;
}
export async function getEntitlement(userId: string, feature: string): Promise<Entitlement> {
  const r = await initDb().query(`SELECT u.plan,e.enabled,e.limit_value FROM app_users u LEFT JOIN plan_entitlements e ON e.plan=u.plan AND e.feature=$2 WHERE u.id=$1`, [userId,feature]);
  if (!r.rowCount) return {allowed:false,limit:0,plan:"unknown"};
  const row=r.rows[0]; return {allowed:row.enabled!==false,limit:row.limit_value==null?null:Number(row.limit_value),plan:row.plan};
}
export async function enforceLimit(userId:string,feature:string,current:number){return assertEntitlement(await getEntitlement(userId,feature),feature,current);}
export async function withEntitlementLock<T>(userId:string,feature:string,work:(client:any)=>Promise<T>):Promise<T>{
  const client=await initDb().connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`entitlement:${userId}:${feature}`]);
    const r=await client.query(`SELECT u.plan,e.enabled,e.limit_value FROM app_users u LEFT JOIN plan_entitlements e ON e.plan=u.plan AND e.feature=$2 WHERE u.id=$1 FOR UPDATE OF u`,[userId,feature]);
    if(!r.rowCount) throw new EntitlementError(feature,0,"user not found");
    const row=r.rows[0], entitlement={allowed:row.enabled!==false,limit:row.limit_value==null?null:Number(row.limit_value),plan:row.plan};
    const result=await work(client); await client.query("COMMIT"); return result;
  }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
}
export async function audit(userId:string|null,action:string,entityType?:string,entityId?:string,metadata:Record<string,unknown>={},requestId?:string){
  await initDb().query(`INSERT INTO audit_log(id,user_id,action,entity_type,entity_id,request_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)`,[randomUUID(),userId,action,entityType??null,entityId??null,requestId??null,JSON.stringify(metadata)]);
}
export type IdempotencyReservation={owner:true;replay:false;key:string}|{owner:false;replay:true;response:unknown;statusCode:number}|{owner:false;replay:false;inProgress:true};
export async function reserveIdempotency(userId:string,scope:string,key:string,ttlSeconds=86400):Promise<IdempotencyReservation|null>{
  const clean=key.trim().slice(0,200); if(!clean)return null;
  const db=initDb(),expires=new Date(Date.now()+ttlSeconds*1000);
  const inserted=await db.query(`INSERT INTO idempotency_keys(id,user_id,key,scope,expires_at,completed_at) VALUES($1,$2,$3,$4,$5,NULL) ON CONFLICT(user_id,scope,key) DO NOTHING RETURNING id`,[randomUUID(),userId,clean,scope,expires]);
  if(inserted.rowCount)return {owner:true,replay:false,key:clean};
  const current=await db.query(`SELECT id,status_code,response,completed_at,expires_at FROM idempotency_keys WHERE user_id=$1 AND scope=$2 AND key=$3`,[userId,scope,clean]);
  if(!current.rowCount)return {owner:false,replay:false,inProgress:true};
  const row=current.rows[0];
  if(new Date(row.expires_at).getTime()<=Date.now()){
    const takeover=await db.query(`UPDATE idempotency_keys SET id=$1,expires_at=$2,status_code=200,response='{}'::jsonb,completed_at=NULL WHERE user_id=$3 AND scope=$4 AND key=$5 AND expires_at<now() RETURNING id`,[randomUUID(),expires,userId,scope,clean]);
    if(takeover.rowCount)return {owner:true,replay:false,key:clean};
  }
  if(row.completed_at)return {owner:false,replay:true,response:row.response,statusCode:Number(row.status_code)};
  return {owner:false,replay:false,inProgress:true};
}
export async function completeIdempotency(userId:string,scope:string,key:string,statusCode:number,response:unknown){
  await initDb().query(`UPDATE idempotency_keys SET status_code=$1,response=$2,completed_at=now() WHERE user_id=$3 AND scope=$4 AND key=$5`,[statusCode,JSON.stringify(response),userId,scope,key.trim().slice(0,200)]);
}
export async function cleanupIdempotency(){await initDb().query("DELETE FROM idempotency_keys WHERE expires_at<now()");}
