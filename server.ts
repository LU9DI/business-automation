import acquisitionAutomationRoutes from "./src/routes/acquisitionAutomationRoutes.js";
import authRoutes from "./src/routes/authRoutes.js";
import workflowRoutes from "./src/routes/workflowRoutes.js";
import webhookRoutes from "./src/routes/webhookRoutes.js";
import express from "express";
import acquisitionRoutes from "./src/routes/acquisitionRoutes.js";
import cors from "cors";
import { initDb } from "./src/core/db.js";
import { metricsMiddleware, metricsSnapshot } from "./src/core/metrics.js";
import { requestId } from "./src/middleware/requestId.js";
import { rateLimit } from "./src/middleware/rateLimit.js";
import { errorHandler } from "./src/middleware/errorHandler.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const origins = process.env.CORS_ORIGIN?.split(",").map((v) => v.trim()).filter(Boolean);
const PUBLIC_PAGES: Array<[string,string,string]> = [["/produto","Business Automation — automação empresarial","Automatize processos com workflows, webhooks e execução controlada."],["/recursos","Recursos do Business Automation","Workflows, conectores, webhooks, limites de execução e rastreabilidade."],["/solucoes","Soluções de automação empresarial","Automação de processos e integrações para operações digitais."],["/guias","Guias de automação empresarial","Guias práticos para estruturar workflows e integrações."],["/faq","FAQ — Business Automation","Perguntas frequentes sobre workflows, webhooks e automação."]];
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch] || ch));
const publicBase = (req: express.Request) => (process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
const renderSite = (req: express.Request, path: string, pageTitle: string, description: string) => {
 const base=publicBase(req), canonical=base+(path==="/"?"":path);
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(pageTitle)} | Business Automation</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><style>:root{--a:#2563eb;--b:#06b6d4;--ink:#152033;--muted:#687386;--line:#e7ebf2}*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;color:var(--ink)}a{text-decoration:none;color:inherit}.nav{height:72px;display:flex;align-items:center;justify-content:space-between;max-width:1160px;margin:auto;padding:0 22px}.brand{font-weight:850}.mark{display:inline-block;width:30px;height:30px;border-radius:9px;vertical-align:middle;margin-right:9px;background:linear-gradient(135deg,var(--a),var(--b))}.links{display:flex;gap:22px;color:var(--muted);font-size:14px}.cta{background:var(--ink);color:white;padding:10px 16px;border-radius:12px;font-weight:750}.hero{padding:82px 22px 95px;background:radial-gradient(circle at 15% 10%,#eef0ff,transparent 32%),radial-gradient(circle at 85% 15%,#fff0f7,transparent 30%),#fff}.wrap{max-width:1160px;margin:auto}.grid{display:grid;grid-template-columns:1.15fr .85fr;gap:55px;align-items:center}.tag{color:var(--a);font-weight:850;font-size:12px}.hero h1{font-size:clamp(42px,6vw,70px);line-height:1.03;letter-spacing:-3px;margin:16px 0}.grad{background:linear-gradient(90deg,var(--a),var(--b));-webkit-background-clip:text;color:transparent}.hero p{font-size:19px;color:var(--muted);max-width:680px}.btn{display:inline-block;margin-top:24px;background:linear-gradient(135deg,var(--a),var(--b));color:white;padding:14px 20px;border-radius:14px;font-weight:800}.panel{background:white;border:1px solid var(--line);border-radius:24px;padding:28px;box-shadow:0 24px 65px #15203318}.item{padding:16px;margin-top:12px;background:#f7f9fc;border-radius:14px}.section{padding:75px 22px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:30px}.card{border:1px solid var(--line);border-radius:20px;padding:23px}.card p{color:var(--muted);font-size:14px}.footer{border-top:1px solid var(--line);padding:34px 22px}.foot{max-width:1160px;margin:auto;display:flex;justify-content:space-between;gap:25px}.fl{display:flex;gap:18px;flex-wrap:wrap}.fl a,small{color:var(--muted);font-size:13px}@media(max-width:800px){.links{display:none}.grid,.cards{grid-template-columns:1fr}.hero h1{letter-spacing:-2px}.foot{flex-direction:column}}</style></head><body><header class="nav"><a class="brand" href="/"><span class="mark"></span>Business Automation</a><nav class="links"><a href="/produto">Produto</a><a href="/recursos">Recursos</a><a href="/guias">Guias</a><a href="/faq">FAQ</a></nav><a class="cta" href="/produto">Começar</a></header><main><section class="hero"><div class="wrap grid"><div><span class="tag">PRODUTO DIGITAL PROFISSIONAL</span><h1>Automação que trabalha junto com sua operação. <span class="grad">sem complicação.</span></h1><p>Automatize processos com workflows, integrações e rastreabilidade.</p><a class="btn" href="/produto">Conhecer o produto</a></div><div class="panel"><strong>Visão geral</strong><div class="item">✨ Experiência simples e moderna</div><div class="item">⚡ Recursos organizados</div><div class="item">📊 Informações claras</div></div></div></section><section class="section"><div class="wrap"><h2>Business Automation</h2><p style="color:#687386;max-width:700px">Automatize processos com workflows, integrações e rastreabilidade.</p><div class="cards"><div class="card"><h3>Simples</h3><p>Interface pensada para reduzir complexidade.</p></div><div class="card"><h3>Inteligente</h3><p>Automação e recursos organizados para o trabalho real.</p></div><div class="card"><h3>Profissional</h3><p>Uma experiência com aparência de produto empresarial.</p></div></div></div></section></main><footer class="footer"><div class="foot"><div><strong>Business Automation</strong><br><small>Uma experiência digital simples, elegante e profissional.</small></div><div class="fl"><a href="/produto">Produto</a><a href="/recursos">Recursos</a><a href="/guias">Guias</a><a href="/faq">FAQ</a><a href="/politica-de-privacidade">Política de Privacidade</a></div></div></footer></body></html>`;
};
const renderPrivacy = () => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Política de Privacidade | Business Automation</title></head><body style="font-family:system-ui;max-width:850px;margin:60px auto;padding:0 24px;color:#152033"><a href="/">← Business Automation</a><h1>Política de Privacidade</h1><p>Esta página descreve o tratamento de informações no Business Automation.</p><h2>Dados tratados</h2><p>Podemos tratar dados de conta, preferências e informações necessárias ao funcionamento do serviço.</p><h2>Uso e segurança</h2><p>As informações são usadas para autenticação, funcionamento, segurança e melhoria do produto, com medidas técnicas e organizacionais apropriadas.</p><h2>Compartilhamento</h2><p>Dados não são vendidos. Prestadores podem processar informações quando necessários para operar funcionalidades do serviço.</p></body></html>`;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(requestId);
app.use(rateLimit);
app.use(cors(origins?.length ? { origin: origins, credentials: true } : { origin: false }));
app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { (req as any).rawBody = Buffer.from(buf); } }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use(metricsMiddleware);

app.use("/api/auth", authRoutes);
app.use("/api/workflows", workflowRoutes);
app.use("/api/webhooks", webhookRoutes);


app.get("/robots.txt", (req, res) => {
  const base = publicBase(req);
  res.type("text/plain").send(`User-agent: *
Allow: /
Disallow: /api/
Disallow: /login
Disallow: /app
Disallow: /dashboard
Disallow: /admin
Sitemap: ${base}/sitemap.xml
`);
});
app.get("/sitemap.xml", (req, res) => {
  const base = publicBase(req);
  const urls = ["/", ...PUBLIC_PAGES.map(([path]) => path), "/politica-de-privacidade"];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((path) => `<url><loc>${escapeHtml(base + (path === "/" ? "" : path))}</loc></url>`).join("")}</urlset>`);
});

const renderPrivateApp = (req: express.Request, path: string) => {
  const brand="Business Automation", subtitle="Workflows claros para automatizar o trabalho da sua operação.", a="#2563eb", b="#06b6d4", api="/api/workflows", dataLabel="workflows", createLabel="Novo workflow", action="workflow";
  const mode = path === "/login" || path === "/cadastro" ? "auth" : "app";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${mode==="auth"?"Acesso":"Painel"} | ${brand}</title><meta name="robots" content="noindex,nofollow,noarchive">
<style>:root{--a:${a};--b:${b};--ink:#152033;--muted:#667085;--line:#e6eaf0;--soft:#f7f9fc}*{box-sizing:border-box}body{margin:0;background:var(--soft);color:var(--ink);font-family:Inter,system-ui,sans-serif}a{text-decoration:none;color:inherit}.top{height:68px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 24px}.brand{display:flex;gap:10px;align-items:center;font-weight:850}.mark{width:30px;height:30px;border-radius:10px;background:linear-gradient(135deg,var(--a),var(--b))}.topnav{display:flex;gap:18px;color:var(--muted);font-size:14px}.shell{max-width:1180px;margin:auto;padding:32px 22px}.auth{min-height:calc(100vh - 68px);display:grid;place-items:center}.box{width:min(430px,100%);background:#fff;border:1px solid var(--line);border-radius:24px;padding:30px;box-shadow:0 20px 55px #15203312}.box h1{font-size:30px;margin:0 0 8px}.muted{color:var(--muted)}label{display:block;font-size:13px;font-weight:700;margin:16px 0 7px}input,select,button,textarea{font:inherit}input,select,textarea{width:100%;padding:12px 13px;border:1px solid var(--line);border-radius:12px;background:#fff}button,.btn{border:0;border-radius:12px;padding:12px 16px;font-weight:800;cursor:pointer;background:linear-gradient(135deg,var(--a),var(--b));color:#fff}.ghost{background:#fff!important;color:var(--ink)!important;border:1px solid var(--line)!important}.full{width:100%;margin-top:18px}.error{margin-top:14px;color:#b42318;font-size:13px}.hero{display:flex;justify-content:space-between;gap:24px;align-items:end;margin-bottom:24px}.hero h1{margin:0;font-size:36px;letter-spacing:-1.5px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:20px}.card strong{font-size:25px}.list{margin-top:18px;display:grid;gap:12px}.row{background:#fff;border:1px solid var(--line);border-radius:16px;padding:17px;display:flex;justify-content:space-between;gap:16px}.pill{display:inline-block;border-radius:999px;padding:5px 9px;background:#f0f3f8;font-size:12px}.modal{display:none;position:fixed;inset:0;background:#15203366;align-items:center;justify-content:center;padding:20px}.modal.on{display:flex}.modal .box{max-width:500px}@media(max-width:800px){.cards{grid-template-columns:1fr}.topnav{display:none}.hero{align-items:start;flex-direction:column}}</style></head><body><header class="top"><a class="brand" href="/"><span class="mark"></span>${brand}</a><nav class="topnav"><a href="/dashboard">Painel</a><a href="/politica-de-privacidade">Privacidade</a><button id="logout" class="ghost">Sair</button></nav></header>
${mode==="auth"?`<main class="auth"><section class="box"><div class="muted" style="font-size:12px;font-weight:800">ÁREA DO PRODUTO</div><h1>${path==="/cadastro"?"Criar sua conta":"Entrar"}</h1><p class="muted">${subtitle}</p><form id="authForm"><label>E-mail</label><input id="email" type="email" autocomplete="email" required><label>Senha</label><input id="password" type="password" minlength="8" required>${path==="/cadastro"?'<label>Confirmar senha</label><input id="password2" type="password" minlength="8" required>':""}<button class="full" type="submit">${path==="/cadastro"?"Criar conta":"Entrar"}</button><div id="msg" class="error"></div></form><p style="margin-top:20px;font-size:14px" class="muted">${path==="/cadastro"?"Já tenho conta":"Ainda não tenho conta"} · <a style="color:var(--a);font-weight:800" href="${path==="/cadastro"?"/login":"/cadastro"}">${path==="/cadastro"?"Entrar":"Criar cadastro"}</a></p></section></main>`:`<main class="shell"><section class="hero"><div><div class="muted" style="font-size:12px;font-weight:850;letter-spacing:.08em">PAINEL</div><h1>${brand}</h1><p class="muted">${subtitle}</p></div><button id="newBtn">${createLabel}</button></section><section class="cards"><div class="card"><span class="muted">Itens</span><br><strong id="count">—</strong></div><div class="card"><span class="muted">Conta</span><br><strong>Ativa</strong></div><div class="card"><span class="muted">Estado</span><br><strong>Operacional</strong></div></section><section class="list" id="list"><div class="card muted">Carregando ${dataLabel}…</div></section></main><div class="modal" id="modal"><form class="box" id="createForm"><h2>${createLabel}</h2><p class="muted">Cadastre um novo item diretamente no produto.</p><div id="fields"></div><button class="full">Salvar</button><button type="button" class="full ghost" id="close">Cancelar</button><div id="createMsg" class="error"></div></form></div>`}
<script>
const token=localStorage.getItem("token"), path=${JSON.stringify(path)}, api="/api/workflows", action="workflow", dataLabel="workflows";
const authForm=document.getElementById("authForm");
if(authForm){authForm.addEventListener("submit",async e=>{e.preventDefault();const msg=document.getElementById("msg");if(path==="/cadastro"&&document.getElementById("password").value!==document.getElementById("password2").value){msg.textContent="As senhas não conferem.";return;}const endpoint=path==="/cadastro"?"/api/auth/register":"/api/auth/login";try{const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:document.getElementById("email").value,password:document.getElementById("password").value})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Não foi possível concluir.");localStorage.setItem("token",d.token);location.href="/dashboard";}catch(err){msg.textContent=err.message;}});}
else{if(!token){location.href="/login";}const logout=document.getElementById("logout");if(logout)logout.onclick=()=>{localStorage.removeItem("token");location.href="/login";};const esc=s=>String(s??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));async function load(){try{let r=await fetch(api,{headers:{Authorization:"Bearer "+token}});if(r.status===401){localStorage.removeItem("token");location.href="/login";return;}let d=await r.json(),items=d[dataLabel]||[];document.getElementById("count").textContent=items.length;document.getElementById("list").innerHTML=items.length?items.map(x=>'<div class="row"><div><strong>'+esc(x.name||x.legal_name||x.title||"Item")+'</strong><div class="muted">'+esc(x.description||x.query||x.regime||x.status||"")+'</div></div><span class="pill">'+esc(x.status||x.regime||"ativo")+'</span></div>').join(""):'<div class="card muted">Nenhum item cadastrado ainda.</div>';if(action==="company"&&items[0]){const t=await fetch("/api/dashboard/"+encodeURIComponent(items[0].id),{headers:{Authorization:"Bearer "+token}});if(t.ok){const td=await t.json();document.getElementById("list").insertAdjacentHTML("afterbegin",'<div class="cards"><div class="card"><span class="muted">Faturamento no ano</span><br><strong>R$ '+Number(td.revenueYearToDate||0).toLocaleString("pt-BR",{minimumFractionDigits:2})+'</strong></div><div class="card"><span class="muted">Impostos pagos</span><br><strong>R$ '+Number(td.taxesPaidYearToDate||0).toLocaleString("pt-BR",{minimumFractionDigits:2})+'</strong></div><div class="card"><span class="muted">Obrigações</span><br><strong>'+Number((td.obligations||[]).length)+'</strong></div></div>');}}}catch{document.getElementById("list").innerHTML='<div class="card">Não foi possível carregar os dados agora.</div>';}}const modal=document.getElementById("modal"),form=document.getElementById("createForm"),fields=document.getElementById("fields");document.getElementById("newBtn").onclick=()=>{modal.classList.add("on");fields.innerHTML=action==="watchlist"?'<label>Nome</label><input name="name" required><label>O que acompanhar</label><input name="query" required><label>Preço-alvo</label><input name="targetPrice" type="number" step="0.01">':action==="workflow"?'<label>Nome</label><input name="name" required><p class="muted" style="font-size:13px">Você poderá adicionar os conectores e etapas no editor do produto.</p>':action==="agent"?'<label>Nome</label><input name="name" required><label>Descrição</label><textarea name="description" required></textarea><label>Versão</label><input name="version" value="1.0.0" required>':'<label>Razão social</label><input name="legalName" required><label>CNPJ</label><input name="cnpj"><label>Regime</label><select name="regime"><option value="mei">MEI</option><option value="simples">Simples Nacional</option><option value="other">Outro</option></select>';};document.getElementById("close").onclick=()=>modal.classList.remove("on");form.onsubmit=async e=>{e.preventDefault();const msg=document.getElementById("createMsg"),body=Object.fromEntries(new FormData(form));if(action==="watchlist"){body.targetPrice=body.targetPrice?Number(body.targetPrice):null;body.currency="BRL";body.budget=null;}if(action==="agent"){body.priceCents=null;body.capabilities=[];}try{const endpoint=action==="agent"?"/api/agents":action==="company"?"/api/companies":api;const payload=action==="workflow"?{name:body.name,enabled:true,steps:[]}:body;const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw new Error(d.error||"Falha ao salvar.");modal.classList.remove("on");form.reset();load();}catch(err){msg.textContent=err.message;}};load();}
</script></body></html>`;
};

app.get(["/login","/cadastro","/app","/dashboard","/admin"], (req, res) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.type("html").send(renderPrivateApp(req, req.path));
});
app.get("/politica-de-privacidade", (_req,res)=>res.type("html").send(renderPrivacy()));
app.get("/", (req,res)=>res.type("html").send(renderSite(req,"/","Business Automation","Automatize processos com workflows, integrações e rastreabilidade.")));
for (const [path, pageTitle, description] of PUBLIC_PAGES) app.get(path,(req,res)=>res.type("html").send(renderSite(req,path,pageTitle,description)));

app.use("/api/acquisition/automation", acquisitionAutomationRoutes);
app.use("/api/acquisition", acquisitionRoutes);

app.get("/api/health", async (_req, res) => {
  try { await initDb().query("SELECT 1"); res.json({ ok: true, service: "business-automation", database: "ok" }); }
  catch { res.status(503).json({ ok: false, database: "error" }); }
});
app.get("/api/metrics", (req, res) => {
  if (process.env.NODE_ENV === "production" && req.header("x-metrics-token") !== process.env.METRICS_TOKEN) return res.status(401).json({ error: "unauthorized" });
  res.json(metricsSnapshot());
});

app.use(errorHandler);
const server = app.listen(port, () => console.log("business-automation API listening on " + port));
const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);