import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { initDb } from "../core/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const PRODUCT = "business-automation";
const SEO = [{"path":"/produto","title":"Business Automation — automação empresarial","description":"Workflows, conectores, webhooks e execução."},{"path":"/recursos","title":"Business Automation — automação empresarial","description":"Workflows, conectores, webhooks e execução."},{"path":"/solucoes","title":"Business Automation — automação empresarial","description":"Workflows, conectores, webhooks e execução."},{"path":"/guias","title":"Business Automation — automação empresarial","description":"Workflows, conectores, webhooks e execução."},{"path":"/faq","title":"Business Automation — automação empresarial","description":"Workflows, conectores, webhooks e execução."}];
const STATUSES = new Set(["researched","selected","scheduled","executed","delivered","published","failed"]);
const CHANNELS = new Set(["email","blog","x","pinterest","devto","hashnode","linkedin","telegram"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function userId(req: any): string {
  return String(req.userId || "");
}
function clean(value: unknown, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v.slice(0, max) : null;
}
function validStatus(value: unknown): string {
  const v = String(value ?? "researched").trim().toLowerCase();
  return STATUSES.has(v) ? v : "";
}
function validUuid(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return UUID_RE.test(v) ? v : null;
}
function validDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function boundedMetadata(value: unknown): Record<string, unknown> | null {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const json = JSON.stringify(value);
  if (json.length > 20000) return null;
  return value as Record<string, unknown>;
}

router.get("/seo/manifest", (_req,res) => res.json({product:PRODUCT,canonicalBase:process.env.PUBLIC_SITE_URL||null,pages:SEO}));
router.get("/sitemap.xml", (_req,res) => {
  const base=(process.env.PUBLIC_SITE_URL||"").replace(/\/$/,"");
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${SEO.map((p:any)=>`<url><loc>${base}${p.path}</loc></url>`).join("")}</urlset>`);
});
router.get("/robots.txt", (_req,res) => {
  const base=(process.env.PUBLIC_SITE_URL||"").replace(/\/$/,"");
  res.type("text/plain").send(`User-agent: *\\nAllow: /\\nSitemap: ${base}/api/acquisition/sitemap.xml\\n`);
});

router.post("/leads",requireAuth,async(req,res)=>{
  try {
    
    const b=req.body||{}, owner=userId(req);
    const email=typeof b.email==="string"?b.email.trim().toLowerCase():null;
    if(email && (email.length>254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))) return res.status(400).json({error:"invalid email"});
    const name=clean(b.name,160),company=clean(b.company,200),source=clean(b.source,80)||"organic";
    const country=clean(b.country,80),language=clean(b.language,20);
    const rawScore=b.score==null?null:Number(b.score);
    if(rawScore!==null && (!Number.isFinite(rawScore)||rawScore<0||rawScore>100)) return res.status(400).json({error:"score must be between 0 and 100"});
    const status=validStatus(b.status);
    if(!status) return res.status(400).json({error:"invalid status"});
    const id=randomUUID();
    await initDb().query("INSERT INTO acquisition_leads(id,email,name,company,source,country,language,score,status,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [id,email,name,company,source,country,language,rawScore,status,owner]);
    res.status(201).json({id,status});
  } catch { res.status(400).json({error:"failed to create lead"}); }
});

router.get("/leads",requireAuth,async(req,res)=>{
  try {  const r=await initDb().query(
    "SELECT id,email,name,company,source,country,language,score,status,last_contact_at,created_at FROM acquisition_leads WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100",[userId(req)]);
    res.json({leads:r.rows});
  } catch { res.status(500).json({error:"failed to list leads"}); }
});

router.post("/content",requireAuth,async(req,res)=>{
  try {
     const b=req.body||{}, owner=userId(req);
    const channel=String(b.channel||"").trim().toLowerCase(), title=clean(b.title,300), body=clean(b.body,100000);
    if(!CHANNELS.has(channel)||!title||!body) return res.status(400).json({error:"invalid channel, title or body"});
    const status=validStatus(b.status); if(!status) return res.status(400).json({error:"invalid status"});
    const scheduledAt=validDate(b.scheduledAt), slug=clean(b.slug,180), utmCampaign=clean(b.utmCampaign,120);
    if(b.scheduledAt!=null && !scheduledAt) return res.status(400).json({error:"invalid scheduledAt"});
    const hash=createHash("sha256").update(channel+"\n"+title+"\n"+body).digest("hex");
    const id=randomUUID();
    const r=await initDb().query(
      "INSERT INTO acquisition_content(id,channel,title,body,slug,content_hash,status,scheduled_at,utm_campaign,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(owner_id,content_hash) WHERE owner_id IS NOT NULL DO NOTHING RETURNING id,status",
      [id,channel,title,body,slug,hash,status,scheduledAt,utmCampaign,owner]);
    if(!r.rowCount) return res.status(409).json({error:"duplicate content",contentHash:hash});
    res.status(201).json({id:r.rows[0].id,status:r.rows[0].status,contentHash:hash});
  } catch { res.status(400).json({error:"failed to create content"}); }
});

router.get("/content",requireAuth,async(req,res)=>{
  try {  const r=await initDb().query(
    "SELECT id,channel,title,slug,status,scheduled_at,published_at,utm_campaign,created_at FROM acquisition_content WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100",[userId(req)]);
    res.json({content:r.rows});
  } catch { res.status(500).json({error:"failed to list content"}); }
});

router.post("/events",requireAuth,async(req,res)=>{
  try {
     const b=req.body||{}, owner=userId(req), type=clean(b.type,80);
    if(!type) return res.status(400).json({error:"event type is required"});
    const leadId=b.leadId==null?null:validUuid(b.leadId);
    const contentId=b.contentId==null?null:validUuid(b.contentId);
    if((b.leadId!=null&&!leadId)||(b.contentId!=null&&!contentId)) return res.status(400).json({error:"invalid leadId or contentId"});
    const metadata=boundedMetadata(b.metadata); if(!metadata) return res.status(400).json({error:"metadata must be a JSON object up to 20KB"});
    if(leadId){const r=await initDb().query("SELECT 1 FROM acquisition_leads WHERE id=$1 AND owner_id=$2",[leadId,owner]);if(!r.rowCount)return res.status(404).json({error:"lead not found"});}
    if(contentId){const r=await initDb().query("SELECT 1 FROM acquisition_content WHERE id=$1 AND owner_id=$2",[contentId,owner]);if(!r.rowCount)return res.status(404).json({error:"content not found"});}
    const key=clean(req.get("Idempotency-Key")||b.idempotencyKey,160), id=randomUUID();
    if(key){const existing=await initDb().query("SELECT id FROM acquisition_events WHERE owner_id=$1 AND idempotency_key=$2",[owner,key]);if(existing.rowCount)return res.status(200).json({id:existing.rows[0].id,duplicate:true});}
    const r=await initDb().query("INSERT INTO acquisition_events(id,lead_id,content_id,type,metadata,owner_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [id,leadId,contentId,type,JSON.stringify(metadata),owner,key]);
    res.status(201).json({id:r.rows[0].id});
  } catch { res.status(400).json({error:"failed to create event"}); }
});

router.get("/report",requireAuth,async(req,res)=>{
  try {
     const db=initDb(), owner=userId(req);
    const [leads,content,events]=await Promise.all([
      db.query("SELECT status,count(*)::int count FROM acquisition_leads WHERE owner_id=$1 GROUP BY status",[owner]),
      db.query("SELECT channel,status,count(*)::int count FROM acquisition_content WHERE owner_id=$1 GROUP BY channel,status",[owner]),
      db.query("SELECT type,count(*)::int count FROM acquisition_events WHERE owner_id=$1 GROUP BY type",[owner])
    ]);
    res.json({product:PRODUCT,leads:leads.rows,content:content.rows,events:events.rows,generatedAt:new Date().toISOString()});
  } catch { res.status(500).json({error:"failed to generate report"}); }
});

export default router;
