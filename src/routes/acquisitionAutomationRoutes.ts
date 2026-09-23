import { Router } from "express";
import { initDb } from "../core/db.js";
import { requireAuth } from "../middleware/auth.js";
import { generateOutreach, sendEmail, fingerprint, integrationStatus } from "../services/acquisitionProvider.js";

const router=Router(); const PRODUCT="business-automation"; const DEFAULT_BATCH=10; const MAX_BATCH=20; const COOLDOWN_DAYS=7;
const uid=(req:any)=>String(req.userId||"");
const batch=(v:unknown)=>{const n=Number(v??DEFAULT_BATCH);return Number.isInteger(n)&&n>=1&&n<=MAX_BATCH?n:DEFAULT_BATCH;};
const text=(v:unknown,max:number)=>typeof v==="string"?v.trim().slice(0,max):"";
const mode=()=>String(process.env.ACQUISITION_AUTOMATION_MODE||"queue").toLowerCase();

router.get("/status",requireAuth,async(_req,res)=>{
  res.json({product:PRODUCT,mode:mode(),integrations:integrationStatus(),safety:{cooldownDays:COOLDOWN_DAYS,maxBatch:MAX_BATCH,realSendingRequiresConfiguredProvider:true,providerTimeoutMs:Math.min(15000,Math.max(3000,Number(process.env.ACQUISITION_PROVIDER_TIMEOUT_MS||10000)))}})
});

router.post("/run",requireAuth,async(req,res)=>{
  const owner=uid(req), requestedKey=text(req.get("Idempotency-Key")||req.body?.idempotencyKey,160);
  if(!requestedKey)return res.status(400).json({error:"Idempotency-Key is required"});
  const limit=batch(req.body?.limit), runMode=mode(), db=initDb(), client=await db.connect(), queued:any[]=[];
  try{
    await client.query("BEGIN");
    const lock=await client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) locked",["acquisition:"+PRODUCT+":"+owner]);
    if(!lock.rows[0].locked){await client.query("ROLLBACK");return res.status(409).json({error:"acquisition run already in progress"});}
    const existing=await client.query("SELECT id FROM acquisition_events WHERE owner_id=$1 AND type='automation_run' AND idempotency_key=$2 LIMIT 1",[owner,requestedKey]);
    if(existing.rowCount){await client.query("ROLLBACK");return res.json({duplicate:true,runId:existing.rows[0].id,mode:runMode});}
    const leads=await client.query(
      "SELECT l.id,l.email,l.name,l.company,l.country,l.language,l.score FROM acquisition_leads l WHERE l.owner_id=$1 AND l.status IN ('researched','selected') AND l.email IS NOT NULL AND l.email<>'' AND (l.last_contact_at IS NULL OR l.last_contact_at<NOW()-INTERVAL '7 days') AND NOT EXISTS (SELECT 1 FROM acquisition_events s WHERE s.owner_id=$1 AND s.lead_id=l.id AND s.type IN ('unsubscribe','email_bounced','email_complained','suppressed') ) AND NOT EXISTS (SELECT 1 FROM acquisition_events q WHERE q.owner_id=$1 AND q.lead_id=l.id AND q.type='outreach_queued' AND q.created_at>NOW()-INTERVAL '7 days') ORDER BY COALESCE(l.score,0) DESC,l.created_at ASC LIMIT $2 FOR UPDATE OF l SKIP LOCKED",
      [owner,limit]
    );
    const runId=(await client.query("INSERT INTO acquisition_events(id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),'automation_run',$1,$2,$3) RETURNING id",[JSON.stringify({product:PRODUCT,mode:runMode,requestedAt:new Date().toISOString(),limit}),owner,requestedKey])).rows[0].id;
    await client.query("COMMIT");

    for(const lead of leads.rows){
      try{
        const draft=await generateOutreach(lead); const fp=fingerprint(lead,draft.text);
        const eventKey="outreach:"+lead.id+":"+fp;
        const claim=await db.query("INSERT INTO acquisition_events(id,lead_id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),$1,'outreach_queued',$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id",[lead.id,JSON.stringify({product:PRODUCT,mode:runMode,channel:"email",email:lead.email,company:lead.company,name:lead.name,country:lead.country,language:lead.language,score:lead.score,subject:draft.subject,body:draft.text,provider:draft.provider,fingerprint:fp,runId}),owner,eventKey]);
        if(!claim.rowCount)continue;
        if(runMode!=="live"){queued.push({leadId:lead.id,email:lead.email,fingerprint:fp,provider:draft.provider,status:"queued"});continue;}
        const sent=await sendEmail(lead.email,draft.subject,draft.text,draft.html,fp);
        if(sent.sent){
          await db.query("INSERT INTO acquisition_events(id,lead_id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),$1,'outreach_sent',$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING",[lead.id,JSON.stringify({product:PRODUCT,channel:"email",provider:sent.provider,providerId:sent.id,subject:draft.subject,fingerprint:fp,runId}),owner,"sent:"+eventKey]);
          await db.query("UPDATE acquisition_leads SET last_contact_at=NOW(),status='executed' WHERE id=$1 AND owner_id=$2",[lead.id,owner]);
          queued.push({leadId:lead.id,email:lead.email,fingerprint:fp,provider:sent.provider,status:"sent"});
        }else{
          await db.query("INSERT INTO acquisition_events(id,lead_id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),$1,'outreach_failed',$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING",[lead.id,JSON.stringify({product:PRODUCT,channel:"email",reason:sent.reason||"provider_failed",fingerprint:fp,runId}),owner,"failed:"+eventKey]);
          queued.push({leadId:lead.id,email:lead.email,fingerprint:fp,provider:draft.provider,status:"provider-gated"});
        }
      }catch{
        queued.push({leadId:lead.id,email:lead.email,status:"failed"});
      }
    }
    const sentCount=queued.filter(x=>x.status==="sent").length;
    res.json({ok:true,product:PRODUCT,runId,mode:runMode,queued:queued.length,sent:sentCount,leads:queued,execution:runMode==="live"?"provider-executed":"queue-only"});
  }catch{try{await client.query("ROLLBACK")}catch{};res.status(500).json({error:"acquisition run failed"});}
  finally{client.release();}
});
export default router;
