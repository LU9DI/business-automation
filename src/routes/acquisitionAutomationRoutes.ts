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
   try{
    const draft=await generateOutreach(lead),fp=fingerprint(lead,draft.text),key="outreach:"+lead.id+":"+fp;
    const claim=await db.query("INSERT INTO acquisition_events(id,lead_id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),$1,'outreach_queued',$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id",[lead.id,JSON.stringify({product:PRODUCT,mode:runMode,channel:"email",email:lead.email,company:lead.company,name:lead.name,country:lead.country,language:lead.language,score:lead.score,subject:draft.subject,body:draft.text,provider:draft.provider,fingerprint:fp,runId}),owner,key]);
    if(!claim.rowCount)continue;
    if(runMode!=="live"){items.push({leadId:lead.id,status:"queued",provider:draft.provider});continue;}
    const sent=await sendEmail(lead.email,draft.subject,draft.text,draft.html,fp);
    if(sent.sent){
     await db.query("INSERT INTO acquisition_events(id,lead_id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),$1,'outreach_sent',$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING",[lead.id,JSON.stringify({product:PRODUCT,channel:"email",provider:sent.provider,providerId:sent.id,subject:draft.subject,fingerprint:fp,runId}),owner,"sent:"+key]);
     await db.query("UPDATE acquisition_leads SET last_contact_at=NOW(),status='executed' WHERE id=$1 AND owner_id=$2",[lead.id,owner]);
     items.push({leadId:lead.id,status:"sent",provider:sent.provider});
    }else items.push({leadId:lead.id,status:"provider-gated"});
   }catch{items.push({leadId:lead.id,status:"failed"});}
  }
  return {status:"ok",runId,queued:items.length,sent:items.filter(x=>x.status==="sent").length,items};
 }catch(e){try{await client.query("ROLLBACK")}catch{};return {status:"failed",error:"acquisition run failed",queued:0,sent:0};}
 finally{client.release();}
}

router.get("/status",requireAuth,async(_req,res)=>res.json({product:PRODUCT,mode:mode(),integrations:integrationStatus(),safety:{cooldownDays:COOLDOWN_DAYS,maxBatch:MAX_BATCH,realSendingRequiresConfiguredProvider:true}}));

router.post("/run",requireAuth,async(req:any,res)=>{
 const owner=String(req.userId||""),key=text(req.get("Idempotency-Key")||req.body?.idempotencyKey,160);
 if(!key)return res.status(400).json({error:"Idempotency-Key is required"});
 const result=await runForOwner(owner,batch(req.body?.limit),mode(),key);
 res.status(result.status==="failed"?500:result.status==="busy"?409:200).json({ok:result.status!=="failed",product:PRODUCT,mode:mode(),...result});
});

router.post("/cron",async(req,res)=>{
 const secret=text(req.get("X-Acquisition-Cron-Secret"),200);
 if(!process.env.ACQUISITION_CRON_SECRET||secret!==process.env.ACQUISITION_CRON_SECRET)return res.status(401).json({error:"unauthorized"});
 const owners=(await initDb().query("SELECT DISTINCT owner_id FROM acquisition_leads WHERE owner_id IS NOT NULL")).rows.map((r:any)=>String(r.owner_id));
 const results=[];
 for(const owner of owners) results.push({owner,...(await runForOwner(owner,MAX_BATCH,mode(),"cron:"+new Date().toISOString().slice(0,13)))});
 res.json({ok:true,product:PRODUCT,owners:owners.length,results,generatedAt:new Date().toISOString()});
});
export default router;
