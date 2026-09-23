import { Router } from "express";
import { createHash } from "node:crypto";
import { initDb } from "../core/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const PRODUCT = "business-automation";
const DEFAULT_BATCH = 10;
const MAX_BATCH = 20;
const COOLDOWN_DAYS = 7;

function uid(req:any){ return String(req.userId || ""); }
function batch(v:unknown){ const n=Number(v ?? DEFAULT_BATCH); return Number.isInteger(n)&&n>=1&&n<=MAX_BATCH?n:DEFAULT_BATCH; }
function text(v:unknown,max:number){ if(typeof v!=="string") return ""; return v.trim().slice(0,max); }
function escapeText(v:string){ return v.replace(/[\r\n]+/g," ").trim(); }
function personalizedDraft(lead:any){
  const name=escapeText(lead.name || "time");
  const company=escapeText(lead.company || "sua empresa");
  const lang=String(lead.language||"pt").toLowerCase();
  if(lang.startsWith("en")) return `Hi ${name}, I came across ${company} and thought the way it handles its customer journey could benefit from a more automated workflow. We are building business-automation, with a 7-day trial. If useful, I can show how it works in a few minutes.`;
  if(lang.startsWith("es")) return `Hola ${name}, conocí ${company} y creo que parte de su operación podría beneficiarse de una automatización más simple. Estamos desarrollando business-automation, con una prueba de 7 días. Si tiene sentido, puedo mostrarle cómo funciona.`;
  return `Olá ${name}, conheci a ${company} e identifiquei uma oportunidade de simplificar parte da operação com automação. Estamos desenvolvendo o business-automation, com teste de 7 dias. Se fizer sentido, posso mostrar rapidamente como funciona.`;
}

router.get("/status", requireAuth, async (_req,res)=>{
  res.json({
    product: PRODUCT,
    mode: process.env.ACQUISITION_AUTOMATION_MODE || "queue",
    integrations: {
      ai: Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY),
      email: Boolean(process.env.RESEND_API_KEY),
      distribution: Boolean(process.env.BUFFER_ACCESS_TOKEN),
      crm: Boolean(process.env.HUBSPOT_ACCESS_TOKEN)
    },
    safety: { cooldownDays: COOLDOWN_DAYS, maxBatch: MAX_BATCH, realSendingRequiresConfiguredProvider: true }
  });
});

router.post("/run", requireAuth, async (req,res)=>{
  const owner=uid(req);
  const requestedKey=text(req.get("Idempotency-Key") || req.body?.idempotencyKey,160);
  if(!requestedKey) return res.status(400).json({error:"Idempotency-Key is required"});
  const limit=batch(req.body?.limit);
  const mode=(process.env.ACQUISITION_AUTOMATION_MODE || "queue").toLowerCase();
  const db=initDb();
  const lockKey="acquisition:"+PRODUCT+":"+owner;
  const client=await db.connect();
  try {
    await client.query("BEGIN");
    const lock=await client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) locked",[lockKey]);
    if(!lock.rows[0].locked){ await client.query("ROLLBACK"); return res.status(409).json({error:"acquisition run already in progress"}); }

    const existing=await client.query(
      "SELECT id FROM acquisition_events WHERE owner_id=$1 AND type='automation_run' AND idempotency_key=$2 LIMIT 1",
      [owner,requestedKey]
    );
    if(existing.rowCount){
      await client.query("ROLLBACK");
      return res.json({duplicate:true,runId:existing.rows[0].id,mode});
    }

    const leads=await client.query(
      "SELECT id,email,name,company,country,language,score FROM acquisition_leads WHERE owner_id=$1 AND status IN ('researched','selected') AND email IS NOT NULL AND email<>'' AND (last_contact_at IS NULL OR last_contact_at < NOW() - INTERVAL '7 days') ORDER BY COALESCE(score,0) DESC, created_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED",
      [owner,limit]
    );

    const runId=(await client.query(
      "INSERT INTO acquisition_events(id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),'automation_run',$1,$2,$3) RETURNING id",
      [JSON.stringify({product:PRODUCT,mode,requestedAt:new Date().toISOString(),limit}),owner,requestedKey]
    )).rows[0].id;

    const queued:any[]=[];
    for(const lead of leads.rows){
      const draft=personalizedDraft(lead);
      const fingerprint=createHash("sha256").update([PRODUCT,lead.id,lead.email,draft].join("\n")).digest("hex");
      const ev=await client.query(
        "INSERT INTO acquisition_events(id,lead_id,type,metadata,owner_id,idempotency_key) VALUES(gen_random_uuid(),$1,'outreach_queued',$2,$3,$4) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id",
        [lead.id,JSON.stringify({product:PRODUCT,mode,channel:"email",email:lead.email,company:lead.company,name:lead.name,country:lead.country,language:lead.language,score:lead.score,draft,fingerprint,runId}),owner,"outreach:"+lead.id+":"+fingerprint]
      );
      if(ev.rowCount){
        await client.query("UPDATE acquisition_leads SET status='selected' WHERE id=$1 AND owner_id=$2",[lead.id,owner]);
        queued.push({leadId:lead.id,email:lead.email,company:lead.company,fingerprint});
      }
    }
    await client.query("COMMIT");
    res.json({ok:true,product:PRODUCT,runId,mode,queued:queued.length,leads:queued,execution:mode==="live" ? "provider-gated" : "queue-only"});
  } catch {
    try{await client.query("ROLLBACK");}catch{}
    res.status(500).json({error:"acquisition run failed"});
  } finally { client.release(); }
});

export default router;
