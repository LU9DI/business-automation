import { Router } from "express";
import { initDb } from "../core/db.js";
import { requireAuth } from "../middleware/auth.js";
import { generateOutreach, sendEmail, fingerprint, integrationStatus } from "../services/acquisitionProvider.js";

const router=Router();
const PRODUCT="business-automation", MAX_BATCH=20, COOLDOWN_DAYS=7;
const text=(v:unknown,max:number)=>typeof v==="string"?v.trim().slice(0,max):"";
const batch=(v:unknown)=>{const n=Number(v??10);return Number.isInteger(n)&&n>=1&&n<=MAX_BATCH?n:10;};
const mode=()=>String(process.env.ACQUISITION_AUTOMATION_MODE||"queue").toLowerCase();

async function runForOwner(owner:string,limit:number,runMode:string,requestedKey:string){
 const db=initDb(),client=await db.connect(),items:any[]=[];
 try{
  await client.query("BEGIN");
  const lock=await client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) locked",["acquisition:"+PRODUCT+":"+owner]);
  if(!lock.rows[0].locked){await client.query("ROLLBACK");return {status:"busy",sent:0,queued:0};}
  const existing=await client.query("SELECT id FROM acquisition_events WHERE owner_id=$1 AND type='automation_run' AND idempotency_key=$2 LIMIT 1",[owner,requestedKey]);
  if(existing.rowCount){await client.query("ROLLBACK");return {status:"duplicate",runId:existing.rows[0].id,sent:0,queued:0};}
  const leads=await client.query("SELECT l.id,l.email,l.name,l.company,l.country,l.language,l.score FROM acquisition_leads l WHERE l.owner_id=$1 AND l.status IN ('researched','selected') AND l.email IS NOT NULL AND l.email<>'' AND (l.last_contact_at IS NULL OR l.last_contact_at<NOW()-INTERVAL '7 days') AND NOT EXISTS (SELECT 1 FROM acquisition_events s WHERE s.owner_id=$1 AND s.lead_id=l.id AND s.type IN ('unsubscribe','email_bounced','email_complained','suppressed')) AND NOT EXISTS (SELECT 1 FROM acquisition_events q WHERE q.owner_id=$1 AND q.lead_id=l.id AND q.type='outreach_queued' AND q.created_at>NOW()-INTERVAL '7 days') ORDER BY COALESCE(l.score,0) DESC,l.created_at ASC LIMIT $2 FOR UPDATE OF l SKIP LOCKED",[owner,limit]);
  const runId=(await client.query("INSERT INTO acquisition_events(id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),'automation_run',$1,$2,$3) RETURNING id",[JSON.stringify({product:PRODUCT,mode:runMode,requestedAt:new Date().toISOString(),limit}),owner,requestedKey])).rows[0].id;
  await client.query("COMMIT");
  for(const lead of leads.rows){
   let draft:any=null,fp="";
   try{
    draft=await generateOutreach(lead); fp=fingerprint(lead,draft.text); const key="outreach:"+lead.id+":"+fp;
    const claim=await db.query("INSERT INTO acquisition_events(id,lead_id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),$1,'outreach_queued',$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id",[lead.id,JSON.stringify({product:PRODUCT,mode:runMode,channel:"email",email:lead.email,company:lead.company,name:lead.name,country:lead.country,language:lead.language,score:lead.score,subject:draft.subject,body:draft.text,provider:draft.provider,fingerprint:fp,runId}),owner,key]);
    if(!claim.rowCount)continue;
    if(runMode!=="live"){items.push({leadId:lead.id,status:"queued",provider:draft.provider});continue;}
    const sent=await sendEmail(lead.email,draft.subject,draft.text,draft.html,fp);
    if(sent.sent){
     await db.query("INSERT INTO acquisition_events(id,lead_id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),$1,'outreach_sent',$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING",[lead.id,JSON.stringify({product:PRODUCT,channel:"email",provider:sent.provider,providerId:sent.id,subject:draft.subject,fingerprint:fp,runId}),owner,"sent:"+key]);
     await db.query("UPDATE acquisition_leads SET last_contact_at=NOW(),status='executed' WHERE id=$1 AND owner_id=$2",[lead.id,owner]);
     items.push({leadId:lead.id,status:"sent",provider:sent.provider});
    }else items.push({leadId:lead.id,status:"provider-gated"});
   }catch(e){
    try{await db.query("INSERT INTO acquisition_events(id,lead_id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),$1,'outreach_failed',$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING",[lead.id,JSON.stringify({product:PRODUCT,channel:"email",retryable:true,attempt:0,nextRetryAt:new Date(Date.now()+60*60*1000).toISOString(),subject:draft?.subject||"",body:draft?.text||"",fingerprint:fp||"",reason:"processing_failed"}),owner,"failed:"+lead.id+":"+String(fp||"unknown")]);}catch{}
    items.push({leadId:lead.id,status:"failed"});}
  }
  return {status:"ok",runId,queued:items.length,sent:items.filter(x=>x.status==="sent").length,items};
 }catch(e){try{await client.query("ROLLBACK")}catch{};return {status:"failed",error:"acquisition run failed",queued:0,sent:0};}
 finally{client.release();}
}

async function recoverForOwner(owner:string,limit:number,runMode:string){
 const db=initDb(),client=await db.connect(),items:any[]=[];
 try{
  await client.query("BEGIN");
  const lock=await client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) locked",["acquisition-recovery:"+PRODUCT+":"+owner]);
  if(!lock.rows[0].locked){await client.query("ROLLBACK");return {status:"busy",recovered:0};}
  const failed=await client.query("SELECT e.id,e.lead_id,e.metadata,l.email FROM acquisition_events e JOIN acquisition_leads l ON l.id=e.lead_id AND l.owner_id=e.owner_id WHERE e.owner_id=$1 AND e.type='outreach_failed' AND COALESCE((e.metadata->>'retryable')::boolean,false)=true AND COALESCE((e.metadata->>'attempt')::int,0)<3 AND COALESCE((e.metadata->>'nextRetryAt')::timestamptz,NOW())<=NOW() AND NOT EXISTS (SELECT 1 FROM acquisition_events s WHERE s.owner_id=e.owner_id AND s.lead_id=e.lead_id AND s.type='outreach_sent') ORDER BY e.created_at ASC LIMIT $2 FOR UPDATE OF e SKIP LOCKED",[owner,limit]);
  await client.query("COMMIT");
  for(const row of failed.rows){
   const m:any=row.metadata||{},attempt=Number(m.attempt||0)+1,retryKey="retry:"+row.id+":"+attempt;
   try{
    const claim=await db.query("INSERT INTO acquisition_events(id,lead_id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),$1,'retry_scheduled',$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id",[row.lead_id,JSON.stringify({product:PRODUCT,attempt,failedEventId:row.id,scheduledAt:new Date().toISOString()}),owner,retryKey]);
    if(!claim.rowCount)continue;
    if(runMode!=="live"){items.push({leadId:row.lead_id,status:"retry-queued",attempt});continue;}
    const body=String(m.body||"");
    const html="<p>"+body.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")+"</p>";
    const sent=await sendEmail(String(row.email),String(m.subject||""),body,html,"sent:"+retryKey);
    if(!sent.sent)throw new Error("provider-gated");
    await db.query("INSERT INTO acquisition_events(id,lead_id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),$1,'outreach_sent',$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING",[row.lead_id,JSON.stringify({product:PRODUCT,channel:"email",provider:sent.provider,providerId:sent.id,subject:m.subject||"",fingerprint:m.fingerprint||"",retryAttempt:attempt,failedEventId:row.id}),owner,"sent:"+retryKey]);
    await db.query("INSERT INTO acquisition_events(id,lead_id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),$1,'retry_succeeded',$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING",[row.lead_id,JSON.stringify({attempt,failedEventId:row.id}),owner,"retry-success:"+retryKey]);
    await db.query("UPDATE acquisition_leads SET last_contact_at=NOW(),status='executed' WHERE id=$1 AND owner_id=$2",[row.lead_id,owner]);
    items.push({leadId:row.lead_id,status:"retry-succeeded",attempt});
   }catch{
    const exhausted=attempt>=3,delayHours=attempt===1?1:4;
    await db.query("INSERT INTO acquisition_events(id,lead_id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),$1,'outreach_failed',$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING",[row.lead_id,JSON.stringify({product:PRODUCT,channel:"email",retryable:!exhausted,attempt,nextRetryAt:new Date(Date.now()+delayHours*60*60*1000).toISOString(),subject:m.subject||"",body:m.body||"",fingerprint:m.fingerprint||"",reason:"retry_failed"}),owner,"failed-retry:"+retryKey]);
    if(exhausted)await db.query("INSERT INTO acquisition_events(id,lead_id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),$1,'retry_exhausted',$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING",[row.lead_id,JSON.stringify({attempt,failedEventId:row.id}),owner,"retry-exhausted:"+retryKey]);
    items.push({leadId:row.lead_id,status:exhausted?"retry-exhausted":"retry-failed",attempt});
   }
  }
  return {status:"ok",recovered:items.filter(x=>x.status==="retry-succeeded").length,items};
 }catch{try{await client.query("ROLLBACK")}catch{};return {status:"failed",recovered:0,items:[]};}finally{client.release();}
}

router.get("/status",requireAuth,async(_req,res)=>res.json({product:PRODUCT,mode:mode(),integrations:integrationStatus(),safety:{cooldownDays:COOLDOWN_DAYS,maxBatch:MAX_BATCH,realSendingRequiresConfiguredProvider:true}}));

router.post("/run",requireAuth,async(req:any,res)=>{
 const owner=String(req.userId||""),key=text(req.get("Idempotency-Key")||req.body?.idempotencyKey,160);
 if(!key)return res.status(400).json({error:"Idempotency-Key is required"});
 const result=await runForOwner(owner,batch(req.body?.limit),mode(),key);
 res.status(result.status==="failed"?500:result.status==="busy"?409:200).json({ok:result.status!=="failed",product:PRODUCT,mode:mode(),...result});
});

const GITHUB_OIDC_ISSUER="https://token.actions.githubusercontent.com";
const GITHUB_OIDC_AUDIENCE="filtra-acquisition";
let oidcKeys:{expiresAt:number;keys:Record<string,any>}|null=null;
function b64urlJson(value:string){return JSON.parse(Buffer.from(value.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-value.length%4)%4),"base64").toString("utf8"));}
async function githubOidcAuthorized(req:any){
 const header=text(req.get("Authorization"),500);
 if(!header.startsWith("Bearer "))return false;
 const token=header.slice(7).trim();
 const parts=token.split(".");
 if(parts.length!==3)return false;
 let head:any,payload:any;
 try{head=b64urlJson(parts[0]);payload=b64urlJson(parts[1]);}catch{return false;}
 if(head.alg!=="RS256"||!head.kid||payload.iss!==GITHUB_OIDC_ISSUER)return false;
 const now=Math.floor(Date.now()/1000);
 if(typeof payload.exp!=="number"||payload.exp<now||typeof payload.nbf==="number"&&payload.nbf>now)return false;
 const aud=Array.isArray(payload.aud)?payload.aud:[payload.aud];
 if(!aud.includes(GITHUB_OIDC_AUDIENCE))return false;
 if(payload.repository!=="LU9DI/business-automation"||payload.repository_owner!=="LU9DI"||payload.ref!=="refs/heads/main"||payload.event_name!=="schedule")return false;
 try{
  if(!oidcKeys||oidcKeys.expiresAt<now){
   const r=await fetch(GITHUB_OIDC_ISSUER+"/.well-known/jwks",{redirect:"error",signal:AbortSignal.timeout(5000)});
   if(!r.ok)return false;
   const data:any=await r.json();
   oidcKeys={expiresAt:now+3600,keys:Object.fromEntries((data.keys||[]).map((k:any)=>[k.kid,k]))};
  }
  const jwk=oidcKeys.keys[head.kid];
  if(!jwk)return false;
  const {createPublicKey,verify}=await import("node:crypto");
  const key=createPublicKey({key:jwk,format:"jwk"});
  const data=Buffer.from(parts[0]+"."+parts[1]);
  const sig=Buffer.from(parts[2].replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-parts[2].length%4)%4),"base64");
  return verify("RSA-SHA256",data,key,sig);
 }catch{return false;}
}

router.post("/cron",async(req,res)=>{
 if(await githubOidcAuthorized(req)){
  const owners=(await initDb().query("SELECT DISTINCT owner_id FROM acquisition_leads WHERE owner_id IS NOT NULL LIMIT 100")).rows.map((r:any)=>String(r.owner_id));
  const results=[];
  for(const owner of owners){const key="cron:"+new Date().toISOString().slice(0,13);const main=await runForOwner(owner,MAX_BATCH,mode(),key);const recovery=await recoverForOwner(owner,MAX_BATCH,mode());results.push({owner,...main,recovery});}
  return res.json({ok:true,product:PRODUCT,owners:owners.length,results,generatedAt:new Date().toISOString()});
 }
 const secret=text(req.get("X-Acquisition-Cron-Secret"),200);
 if(process.env.ACQUISITION_CRON_SECRET&&secret===process.env.ACQUISITION_CRON_SECRET){
  const owners=(await initDb().query("SELECT DISTINCT owner_id FROM acquisition_leads WHERE owner_id IS NOT NULL")).rows.map((r:any)=>String(r.owner_id));
  const results=[];
  for(const owner of owners) results.push({owner,...(await runForOwner(owner,MAX_BATCH,mode(),"cron:"+new Date().toISOString().slice(0,13)))});
  return res.json({ok:true,product:PRODUCT,owners:owners.length,results,generatedAt:new Date().toISOString()});
 }
 return res.status(401).json({error:"unauthorized"});
});
export default router;
