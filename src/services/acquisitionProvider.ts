import { createHash } from "node:crypto";

type Lead = { id:string; email:string; name?:string|null; company?:string|null; country?:string|null; language?:string|null; score?:number|null };
type AiResult = { subject:string; text:string; html:string; provider:"groq"|"gemini"|"template" };

const TIMEOUT_MS = Math.min(15000, Math.max(3000, Number(process.env.ACQUISITION_PROVIDER_TIMEOUT_MS || 10000)));
const PRODUCT = "business-automation";
const env=(n:string)=>String(process.env[n]||"").trim();
const safeText=(v:unknown,max:number)=>typeof v==="string"?v.replace(/[\r\n]+/g," ").trim().slice(0,max):"";
const esc=(v:string)=>v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

async function requestJson(url:string, init:RequestInit){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  try{ const r=await fetch(url,{...init,signal:controller.signal,redirect:"error"}); const raw=await r.text();
    if(raw.length>200000) throw new Error("provider response too large");
    let body:any=null; try{body=raw?JSON.parse(raw):null;}catch{body={};}
    if(!r.ok) throw new Error("provider request failed: "+r.status); return body;
  } finally{clearTimeout(timer);}
}
function template(lead:Lead):AiResult{
  const name=safeText(lead.name,120)||"você", company=safeText(lead.company,160)||"sua empresa", lang=String(lead.language||"pt").toLowerCase();
  if(lang.startsWith("en")){const text="Hi "+name+", I came across "+company+" and thought there may be an opportunity to simplify part of the operation with "+PRODUCT+". We offer a 7-day trial. If useful, I can show you how it works in a few minutes.";return {subject:PRODUCT+" — a simpler workflow for "+company,text,html:"<p>"+esc(text)+"</p>",provider:"template"};}
  if(lang.startsWith("es")){const text="Hola "+name+", conocí "+company+" y creo que hay una oportunidad de simplificar parte de la operación con "+PRODUCT+". Ofrecemos una prueba de 7 días. Si tiene sentido, puedo mostrarle cómo funciona en pocos minutos.";return {subject:PRODUCT+" — automatización para "+company,text,html:"<p>"+esc(text)+"</p>",provider:"template"};}
  const text="Olá "+name+", conheci a "+company+" e identifiquei uma oportunidade de simplificar parte da operação com "+PRODUCT+". Oferecemos um teste de 7 dias. Se fizer sentido, posso mostrar rapidamente como funciona.";return {subject:PRODUCT+" — uma forma mais simples de automatizar "+company,text,html:"<p>"+esc(text)+"</p>",provider:"template"};
}
async function ai(lead:Lead):Promise<AiResult>{
  const groq=env("GROQ_API_KEY"), gemini=env("GEMINI_API_KEY"); if(!groq&&!gemini)return template(lead);
  const prompt="Create one concise, personalized B2B outreach email for the product \""+PRODUCT+"\". Lead name: \""+safeText(lead.name,120)+"\". Company: \""+safeText(lead.company,160)+"\". Country: \""+safeText(lead.country,80)+"\". Language: \""+String(lead.language||"pt").toLowerCase()+"\". Mention a 7-day trial. Do not claim facts about the company that were not provided. No spammy urgency, fake scarcity, or generic mass-marketing language. Return JSON only with keys subject and text. Subject under 90 chars and text under 900 chars.";
  try{if(groq){const d=await requestJson("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+groq,"Content-Type":"application/json"},body:JSON.stringify({model:env("GROQ_MODEL")||"llama-3.3-70b-versatile",temperature:.4,max_tokens:500,response_format:{type:"json_object"},messages:[{role:"system",content:"You write concise ethical B2B outreach. Output JSON only."},{role:"user",content:prompt}]})});const x=JSON.parse(String(d?.choices?.[0]?.message?.content||"{}"));if(typeof x.subject==="string"&&typeof x.text==="string"&&x.text.trim()){const text=x.text.trim().slice(0,900);return {subject:x.subject.trim().slice(0,90),text,html:"<p>"+esc(text)+"</p>",provider:"groq"};}}}catch{}
  try{if(gemini){const model=env("GEMINI_MODEL")||"gemini-2.5-flash";const d=await requestJson("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(gemini),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.4,responseMimeType:"application/json",maxOutputTokens:500}})});const x=JSON.parse(String(d?.candidates?.[0]?.content?.parts?.[0]?.text||"{}"));if(typeof x.subject==="string"&&typeof x.text==="string"&&x.text.trim()){const text=x.text.trim().slice(0,900);return {subject:x.subject.trim().slice(0,90),text,html:"<p>"+esc(text)+"</p>",provider:"gemini"};}}}catch{}
  return template(lead);
}
export async function generateOutreach(lead:Lead){return ai(lead);}
export async function sendEmail(to:string,subject:string,text:string,html:string,idempotencyKey:string){
  const key=env("RESEND_API_KEY"),from=env("RESEND_FROM_EMAIL"); if(!key||!from)return {sent:false,reason:"resend_not_configured"};
  const d=await requestJson("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","Idempotency-Key":idempotencyKey},body:JSON.stringify({from,to:[to],subject,text,html})});
  return {sent:true,id:String(d?.id||""),provider:"resend"};
}
export function fingerprint(lead:Lead,text:string){return createHash("sha256").update([PRODUCT,lead.id,lead.email,text].join("\n")).digest("hex");}
export function integrationStatus(){return {ai:Boolean(env("GROQ_API_KEY")||env("GEMINI_API_KEY")),email:Boolean(env("RESEND_API_KEY")&&env("RESEND_FROM_EMAIL")),distribution:Boolean(env("BUFFER_ACCESS_TOKEN")),crm:Boolean(env("HUBSPOT_ACCESS_TOKEN"))};}
