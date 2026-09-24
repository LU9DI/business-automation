import { Router } from "express";
import { randomUUID } from "node:crypto";
import { initDb, withTransaction } from "../core/db.js";
import { requireAuth } from "../middleware/auth.js";
import { ENTITY_TYPES, RULE_KINDS, RULE_SEVERITIES, cleanText, finiteNumber } from "../domain/sentinelValidation.js";

const router = Router();
router.use(requireAuth);
const uid=(req:any)=>String(req.userId);
const json=(v:unknown)=>JSON.stringify(v??{});


router.get("/overview",async(req,res)=>{
 try{const u=uid(req);const [e,r,v,a,t]=await Promise.all([
  initDb().query("SELECT COUNT(*)::int count FROM sentinel_entities WHERE user_id=$1",[u]),
  initDb().query("SELECT COUNT(*)::int count FROM sentinel_edges WHERE user_id=$1",[u]),
  initDb().query("SELECT COUNT(*)::int count,COALESCE(SUM(amount),0)::numeric total FROM sentinel_events WHERE user_id=$1",[u]),
  initDb().query("SELECT COUNT(*)::int count FROM sentinel_alerts WHERE user_id=$1 AND status IN ('open','reviewing')",[u]),
  initDb().query("SELECT e.id,e.name,e.entity_type,COUNT(se.id)::int degree FROM sentinel_entities e LEFT JOIN sentinel_edges se ON se.user_id=e.user_id AND(se.source_id=e.id OR se.target_id=e.id) WHERE e.user_id=$1 GROUP BY e.id ORDER BY degree DESC,e.name LIMIT 10",[u])
 ]);res.json({entities:+e.rows[0].count,relationships:+r.rows[0].count,events:+v.rows[0].count,eventValue:String(v.rows[0].total),openAlerts:+a.rows[0].count,mostConnected:t.rows})}
 catch{res.status(500).json({error:"failed to load intelligence overview"})}
});

router.get("/search",async(req,res)=>{
 try{
  const u=uid(req),q=cleanText(req.query.q,120),type=cleanText(req.query.type,30),limit=Math.min(Math.max(Number(req.query.limit)||30,1),50);
  if(q.length<2)return res.json({results:[]});
  const like = "%" + q.replace(/[%_]/g, "\\$&") + "%";
  const p:any[]=[u,like],filters=type&&["entity","case","alert"].includes(type)?type:"";
  const out:any[]=[];
  if(!filters||filters==="entity"){
   const r=await initDb().query("SELECT id,'entity' result_type,entity_type type,name,title_ref,external_ref,updated_at FROM (SELECT id,entity_type,name,external_ref,updated_at,external_ref AS title_ref FROM sentinel_entities WHERE user_id=$1 AND (name ILIKE $2 OR COALESCE(external_ref,'') ILIKE $2)) q ORDER BY updated_at DESC LIMIT $3",[u,like,limit]);
   out.push(...r.rows);
  }
  if(!filters||filters==="case"){
   const r=await initDb().query("SELECT id,'case' result_type,status type,title,NULL::text external_ref,updated_at FROM sentinel_cases WHERE user_id=$1 AND (title ILIKE $2 OR purpose ILIKE $2) ORDER BY updated_at DESC LIMIT $3",[u,like,limit]);
   out.push(...r.rows);
  }
  if(!filters||filters==="alert"){
   const r=await initDb().query("SELECT id,'alert' result_type,severity type,title,NULL::text external_ref,updated_at FROM sentinel_alerts WHERE user_id=$1 AND (title ILIKE $2 OR summary ILIKE $2) ORDER BY updated_at DESC LIMIT $3",[u,like,limit]);
   out.push(...r.rows);
  }
  res.json({query:q,results:out.slice(0,limit),algorithmVersion:"horus-search-v1"});
 }catch{res.status(500).json({error:"search failed"})}
});

router.get("/entities/:id/evidence",async(req,res)=>{
 try{
  const u=uid(req),id=cleanText(req.params.id,80);
  const e=await initDb().query("SELECT id,entity_type,name,external_ref,metadata,created_at,updated_at FROM sentinel_entities WHERE id=$1 AND user_id=$2",[id,u]);
  if(!e.rowCount)return res.status(404).json({error:"entity not found"});
  const [relationships,events,alerts]=await Promise.all([
   initDb().query("SELECT r.id,r.source_id,r.target_id,r.relation,r.weight,r.metadata,CASE WHEN r.source_id=$2 THEN t.name ELSE s.name END AS other_name,CASE WHEN r.source_id=$2 THEN r.target_id ELSE r.source_id END AS other_id FROM sentinel_edges r JOIN sentinel_entities s ON s.id=r.source_id AND s.user_id=r.user_id JOIN sentinel_entities t ON t.id=r.target_id AND t.user_id=r.user_id WHERE r.user_id=$1 AND (r.source_id=$2 OR r.target_id=$2) ORDER BY r.weight DESC NULLS LAST LIMIT 100",[u,id]),
   initDb().query("SELECT ev.id,ev.event_type,ev.occurred_at,ev.amount,ev.currency,ev.source,ev.metadata FROM sentinel_events ev WHERE ev.user_id=$1 AND ev.entity_id=$2 ORDER BY ev.occurred_at DESC LIMIT 100",[u,id]),
   initDb().query("SELECT id,alert_type,severity,status,title,summary,rationale,created_at FROM sentinel_alerts WHERE user_id=$1 AND entity_ids @> $2::jsonb ORDER BY created_at DESC LIMIT 50",[u,json([id])])
  ]);
  res.json({entity:e.rows[0],relationships:relationships.rows,events:events.rows,alerts:alerts.rows,algorithmVersion:"horus-entity-evidence-v1",humanReviewRequired:true});
 }catch{res.status(500).json({error:"failed to load entity evidence"})}
});

router.get("/entities",async(req,res)=>{try{const l=Math.min(Math.max(Number(req.query.limit)||100,1),100);const r=await initDb().query("SELECT id,entity_type,name,external_ref,metadata,created_at,updated_at FROM sentinel_entities WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2",[uid(req),l]);res.json({entities:r.rows})}catch{res.status(500).json({error:"failed to load entities"})}});

router.post("/entities",async(req,res)=>{
 const b=req.body||{},n=cleanText(b.name),t=cleanText(b.entityType),ok=ENTITY_TYPES;
 if(!n||!ok.includes(t))return res.status(400).json({error:"name and valid entityType are required"});
 try{const id=randomUUID();await initDb().query("INSERT INTO sentinel_entities(id,user_id,entity_type,name,external_ref,metadata) VALUES($1,$2,$3,$4,$5,$6)",[id,uid(req),t,n,cleanText(b.externalRef,120)||null,json(b.metadata)]);res.status(201).json({entity:{id,name:n,entity_type:t}})}catch{res.status(500).json({error:"failed to create entity"})}
});

router.post("/relationships",async(req,res)=>{
 const b=req.body||{},s=cleanText(b.sourceId,80),t=cleanText(b.targetId,80),rel=cleanText(b.relation,100);
 if(!s||!t||!rel||s===t)return res.status(400).json({error:"sourceId, targetId and relation are required"});
 try{const r=await initDb().query("INSERT INTO sentinel_edges(id,user_id,source_id,target_id,relation,weight,metadata) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM sentinel_entities WHERE id=$3 AND user_id=$2) AND EXISTS(SELECT 1 FROM sentinel_entities WHERE id=$4 AND user_id=$2) ON CONFLICT(user_id,source_id,target_id,relation) DO UPDATE SET weight=sentinel_edges.weight+EXCLUDED.weight,metadata=EXCLUDED.metadata RETURNING id,source_id,target_id,relation,weight",[randomUUID(),uid(req),s,t,rel,finiteNumber(b.weight)??1,json(b.metadata)]);if(!r.rowCount)return res.status(404).json({error:"entities not found in your workspace"});res.status(201).json({relationship:r.rows[0]})}catch{res.status(500).json({error:"failed to create relationship"})}
});

router.post("/events",async(req,res)=>{
 const b=req.body||{},type=cleanText(b.eventType,80),occurred=String(b.occurredAt||"");
 if(!type||!occurred||Number.isNaN(Date.parse(occurred)))return res.status(400).json({error:"eventType and valid occurredAt are required"});
 try{const id=randomUUID(),entity=b.entityId?cleanText(b.entityId,80):null;const r=await initDb().query("INSERT INTO sentinel_events(id,user_id,event_type,occurred_at,entity_id,amount,currency,source,metadata) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE $5 IS NULL OR EXISTS(SELECT 1 FROM sentinel_entities WHERE id=$5 AND user_id=$2) RETURNING id,event_type,occurred_at,entity_id,amount,currency,source",[id,uid(req),type,occurred,entity,finiteNumber(b.amount),cleanText(b.currency,10)||null,cleanText(b.source,60)||"manual",json(b.metadata)]);if(!r.rowCount)return res.status(404).json({error:"entity not found in your workspace"});res.status(201).json({event:r.rows[0]})}catch{res.status(500).json({error:"failed to create event"})}
});

router.post("/demo-data",async(req,res)=>{
 try{const u=uid(req);const out=await withTransaction(async c=>{const ids=Object.fromEntries(["companyA","companyB","personX","personY","contract1","account1","account2"].map(k=>[k,randomUUID()]));const es=[[ids.companyA,"company","Orion Serviços Ltda"],[ids.companyB,"company","Nova Horizonte Participações"],[ids.personX,"person","Pessoa Exemplo A"],[ids.personY,"person","Pessoa Exemplo B"],[ids.contract1,"contract","Contrato público demonstrativo"],[ids.account1,"account","Conta demonstrativa 001"],[ids.account2,"account","Conta demonstrativa 002"]];for(const [id,type,name] of es)await c.query("INSERT INTO sentinel_entities(id,user_id,entity_type,name,metadata) VALUES($1,$2,$3,$4,$5)",[id,u,type,name,json({synthetic:true})]);const ed=[[ids.personX,ids.companyA,"owns"],[ids.personY,ids.companyB,"owns"],[ids.companyA,ids.companyB,"supplier"],[ids.companyA,ids.contract1,"contractor"],[ids.companyB,ids.contract1,"related_party"],[ids.companyA,ids.account1,"controls"],[ids.companyB,ids.account2,"controls"],[ids.account1,ids.account2,"transfer_link"]];for(const [s,t,r] of ed)await c.query("INSERT INTO sentinel_edges(id,user_id,source_id,target_id,relation,metadata) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),u,s,t,r,json({synthetic:true})]);for(let i=0;i<8;i++)await c.query("INSERT INTO sentinel_events(id,user_id,event_type,occurred_at,entity_id,amount,currency,source,metadata) VALUES($1,$2,$3,now()-make_interval(days=>$4),$5,$6,'BRL','demo',$7)",[randomUUID(),u,i%2?"transfer":"contract_payment",i,i%2?ids.account1:ids.companyA,(i+1)*12500,json({synthetic:true})]);return{entities:es.length,relationships:ed.length,events:8}});res.status(201).json({synthetic:true,...out,message:"Dataset demonstrativo criado. Não representa dados reais nem conclusões investigativas."})}catch{res.status(500).json({error:"failed to create synthetic dataset"})}
});

router.post("/analyze",async(req,res)=>{
 try{const u=uid(req),alerts:any[]=[];const d=await initDb().query("SELECT e.id,e.name,e.entity_type,COUNT(se.id)::int degree FROM sentinel_entities e JOIN sentinel_edges se ON se.user_id=e.user_id AND(se.source_id=e.id OR se.target_id=e.id) WHERE e.user_id=$1 GROUP BY e.id HAVING COUNT(se.id)>=4 ORDER BY degree DESC LIMIT 20",[u]);for(const x of d.rows)alerts.push({type:"dense_relationships",severity:x.degree>=7?"high":"medium",title:"Nó com alta conectividade",summary:"A entidade possui muitas relações no grafo e merece revisão contextual.",rationale:{degree:x.degree,method:"degree_threshold",humanReviewRequired:true},entityIds:[x.id]});const f=await initDb().query("SELECT entity_id,COUNT(*)::int event_count,COALESCE(SUM(amount),0)::numeric total FROM sentinel_events WHERE user_id=$1 AND entity_id IS NOT NULL AND occurred_at>=now()-interval '30 days' GROUP BY entity_id HAVING COUNT(*)>=5 ORDER BY event_count DESC LIMIT 20",[u]);for(const x of f.rows)alerts.push({type:"repeated_activity",severity:+x.event_count>=10?"high":"medium",title:"Atividade repetida concentrada",summary:"Foram observados múltiplos eventos associados à mesma entidade no período analisado.",rationale:{eventCount:+x.event_count,total:String(x.total),window:"30d",method:"frequency_threshold",humanReviewRequired:true},entityIds:[x.entity_id]});let inserted=0;for(const a of alerts){const q=await initDb().query("SELECT 1 FROM sentinel_alerts WHERE user_id=$1 AND alert_type=$2 AND status IN('open','reviewing') AND entity_ids @> $3::jsonb LIMIT 1",[u,a.type,json(a.entityIds)]);if(!q.rowCount){await initDb().query("INSERT INTO sentinel_alerts(id,user_id,alert_type,severity,title,summary,rationale,entity_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[randomUUID(),u,a.type,a.severity,a.title,a.summary,json(a.rationale),json(a.entityIds)]);inserted++}}res.json({generated:inserted,candidates:alerts.length,disclaimer:"Alertas são sinais para análise humana; não constituem prova de crime, lavagem de dinheiro ou irregularidade."})}catch{res.status(500).json({error:"analysis failed"})}
});

router.get("/alerts",async(req,res)=>{try{const status=cleanText(req.query.status,20),p:any[]=[uid(req)];let sql="SELECT id,alert_type,severity,status,title,summary,rationale,entity_ids,created_at,updated_at FROM sentinel_alerts WHERE user_id=$1";if(status){sql+=" AND status=$2";p.push(status)}sql+=" ORDER BY created_at DESC LIMIT 100";const r=await initDb().query(sql,p);res.json({alerts:r.rows})}catch{res.status(500).json({error:"failed to load alerts"})}});

router.patch("/alerts/:id",async(req,res)=>{const status=cleanText(req.body?.status,20);if(!["open","reviewing","dismissed","confirmed"].includes(status))return res.status(400).json({error:"invalid status"});try{const r=await initDb().query("UPDATE sentinel_alerts SET status=$1,updated_at=now() WHERE id=$2 AND user_id=$3 RETURNING id,status,updated_at",[status,req.params.id,uid(req)]);if(!r.rowCount)return res.status(404).json({error:"alert not found"});res.json({alert:r.rows[0]})}catch{res.status(500).json({error:"failed to update alert"})}});

router.post("/cases", async (req,res)=>{
  const title=cleanText(req.body?.title,180), purpose=cleanText(req.body?.purpose,500);
  if(!title||!purpose)return res.status(400).json({error:"title and purpose are required"});
  try{
    const id=randomUUID(),u=uid(req);
    const r=await initDb().query("INSERT INTO sentinel_cases(id,user_id,title,purpose,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,title,status,purpose,classification,created_at",[id,u,title,purpose,u]);
    await initDb().query("INSERT INTO sentinel_audit_log(id,user_id,actor_id,action,resource_type,resource_id,purpose) VALUES($1,$2,$3,$4,$5,$6,$7)",[randomUUID(),u,u,"case.created","case",id,purpose]);
    res.status(201).json({case:r.rows[0]});
  }catch{res.status(500).json({error:"failed to create case"});}
});

router.get("/cases",async(req,res)=>{
  try{const r=await initDb().query("SELECT id,title,status,purpose,classification,created_at,updated_at FROM sentinel_cases WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100",[uid(req)]);res.json({cases:r.rows})}
  catch{res.status(500).json({error:"failed to load cases"})}
});

router.post("/cases/:id/entities",async(req,res)=>{
  const entityId=cleanText(req.body?.entityId,80),role=cleanText(req.body?.role,80)||"subject_of_analysis";
  if(!entityId)return res.status(400).json({error:"entityId is required"});
  try{
    const u=uid(req);
    const ok=await initDb().query("SELECT 1 FROM sentinel_cases WHERE id=$1 AND user_id=$2",[req.params.id,u]);
    if(!ok.rowCount)return res.status(404).json({error:"case not found"});
    const ent=await initDb().query("SELECT 1 FROM sentinel_entities WHERE id=$1 AND user_id=$2",[entityId,u]);
    if(!ent.rowCount)return res.status(404).json({error:"entity not found"});
    await initDb().query("INSERT INTO sentinel_case_entities(case_id,entity_id,role) VALUES($1,$2,$3) ON CONFLICT(case_id,entity_id) DO UPDATE SET role=EXCLUDED.role",[req.params.id,entityId,role]);
    await initDb().query("UPDATE sentinel_cases SET updated_at=now() WHERE id=$1 AND user_id=$2",[req.params.id,u]);
    await initDb().query("INSERT INTO sentinel_audit_log(id,user_id,actor_id,action,resource_type,resource_id,purpose,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[randomUUID(),u,u,"case.entity.attached","case",req.params.id,"case analysis",json({entityId,role})]);
    res.status(201).json({attached:true});
  }catch{res.status(500).json({error:"failed to attach entity"});}
});

router.post("/analysis/run",async(req,res)=>{
  const caseId=req.body?.caseId?cleanText(req.body.caseId,80):null;
  try{
    const u=uid(req);
    if(caseId){const c=await initDb().query("SELECT 1 FROM sentinel_cases WHERE id=$1 AND user_id=$2",[caseId,u]);if(!c.rowCount)return res.status(404).json({error:"case not found"});}
    let summary:any;
    if(caseId){
      const [entities,events,relationships]=await Promise.all([
        initDb().query("SELECT COUNT(*)::int count FROM sentinel_case_entities WHERE case_id=$1",[caseId]),
        initDb().query("SELECT COUNT(*)::int count FROM sentinel_events ev WHERE ev.user_id=$1 AND ev.entity_id IN (SELECT entity_id FROM sentinel_case_entities WHERE case_id=$2)",[u,caseId]),
        initDb().query("SELECT COUNT(*)::int count FROM sentinel_edges e WHERE e.user_id=$1 AND (e.source_id IN (SELECT entity_id FROM sentinel_case_entities WHERE case_id=$2) OR e.target_id IN (SELECT entity_id FROM sentinel_case_entities WHERE case_id=$2))",[u,caseId])
      ]);
      summary={entities:Number(entities.rows[0].count),events:Number(events.rows[0].count),relationships:Number(relationships.rows[0].count),caseScoped:true,mode:"rule_based_screening",humanReviewRequired:true};
    }else{
      const [entities,events,relationships]=await Promise.all([
        initDb().query("SELECT COUNT(*)::int count FROM sentinel_entities WHERE user_id=$1",[u]),
        initDb().query("SELECT COUNT(*)::int count FROM sentinel_events WHERE user_id=$1",[u]),
        initDb().query("SELECT COUNT(*)::int count FROM sentinel_edges WHERE user_id=$1",[u])
      ]);
      summary={entities:Number(entities.rows[0].count),events:Number(events.rows[0].count),relationships:Number(relationships.rows[0].count),caseScoped:false,mode:"rule_based_screening",humanReviewRequired:true};
    }
    const id=randomUUID();
    await initDb().query("INSERT INTO sentinel_analysis_runs(id,user_id,case_id,analysis_type,algorithm_version,input_summary,result_summary) VALUES($1,$2,$3,$4,$5,$6,$7)",[id,u,caseId,"screening","sentinel-rules-v1",json(summary),json(summary)]);
    await initDb().query("INSERT INTO sentinel_audit_log(id,user_id,actor_id,action,resource_type,resource_id,purpose,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[randomUUID(),u,u,"analysis.run","analysis_run",id,"authorized investigative screening",json({caseId,algorithmVersion:"sentinel-rules-v1"})]);
    res.status(201).json({run:{id,...summary},disclaimer:"Screening is assistive only. It does not establish criminal conduct, money laundering, guilt or liability."});
  }catch{res.status(500).json({error:"failed to run analysis"});}
});

router.get("/audit",async(req,res)=>{
  try{const r=await initDb().query("SELECT id,actor_id,action,resource_type,resource_id,purpose,metadata,created_at FROM sentinel_audit_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200",[uid(req)]);res.json({audit:r.rows})}
  catch{res.status(500).json({error:"failed to load audit log"})}
});


router.get("/overview/events",async(req,res)=>{
 try{
  const r=await initDb().query("SELECT ev.id,ev.event_type,ev.occurred_at,ev.entity_id,ev.amount,ev.currency,ev.source,e.name AS entity_name FROM sentinel_events ev LEFT JOIN sentinel_entities e ON e.id=ev.entity_id AND e.user_id=ev.user_id WHERE ev.user_id=$1 ORDER BY ev.occurred_at DESC LIMIT 200",[uid(req)]);
  res.json({events:r.rows});
 }catch{res.status(500).json({error:"failed to load event timeline"});}
});

router.get("/graph",async(req,res)=>{
 try{
  const u=uid(req),limit=Math.min(Math.max(Number(req.query.limit)||250,1),500),depth=Math.min(Math.max(Number(req.query.depth)||2,1),5);
  const entities=await initDb().query("SELECT id,entity_type,name,external_ref,metadata FROM sentinel_entities WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2",[u,limit]);
  const edges=await initDb().query("SELECT id,source_id,target_id,relation,weight,metadata FROM sentinel_edges WHERE user_id=$1 LIMIT 1000",[u]);
  res.json({entities:entities.rows,relationships:edges.rows,depth,algorithmVersion:"horus-graph-v1"});
 }catch{res.status(500).json({error:"failed to load graph"})}
});

router.get("/graph/path",async(req,res)=>{
 const from=cleanText(req.query.from,80),to=cleanText(req.query.to,80);
 if(!from||!to)return res.status(400).json({error:"from and to are required"});
 try{
  const u=uid(req);
  const r=await initDb().query(`
   WITH RECURSIVE walk(node_id, path, depth) AS (
     SELECT $2::text, ARRAY[$2::text], 0
     UNION ALL
     SELECT CASE WHEN e.source_id=w.node_id THEN e.target_id ELSE e.source_id END,
            w.path || CASE WHEN e.source_id=w.node_id THEN e.target_id ELSE e.source_id END,
            w.depth+1
     FROM walk w
     JOIN sentinel_edges e ON e.user_id=$1 AND (e.source_id=w.node_id OR e.target_id=w.node_id)
     WHERE w.depth < 5
       AND NOT (CASE WHEN e.source_id=w.node_id THEN e.target_id ELSE e.source_id END = ANY(w.path))
   )
   SELECT path,depth FROM walk WHERE node_id=$3 ORDER BY depth LIMIT 1
  `,[u,from,to]);
  if(!r.rowCount)return res.status(404).json({error:"no path found within five hops"});
  const ids=r.rows[0].path;
  const nodes=await initDb().query("SELECT id,entity_type,name,external_ref FROM sentinel_entities WHERE user_id=$1 AND id=ANY($2::text[])",[u,ids]);
  res.json({path:ids,nodes:nodes.rows,depth:r.rows[0].depth,algorithmVersion:"horus-path-v1",humanReviewRequired:true});
 }catch{res.status(500).json({error:"graph path analysis failed"})}
});

router.get("/cases/:id/graph",async(req,res)=>{
 try{
  const u=uid(req),caseId=cleanText(req.params.id,80);
  const depth=Math.min(Math.max(Number(req.query.depth)||1,1),3);
  const limit=Math.min(Math.max(Number(req.query.limit)||250,1),500);
  const c0=await initDb().query("SELECT 1 FROM sentinel_cases WHERE id=$1 AND user_id=$2",[caseId,u]);
  if(!c0.rowCount)return res.status(404).json({error:"case not found"});
  const seeds=await initDb().query("SELECT entity_id FROM sentinel_case_entities WHERE case_id=$1",[caseId]);
  const seedIds=seeds.rows.map((x:any)=>x.entity_id);
  if(!seedIds.length)return res.json({caseId,depth,entities:[],relationships:[],caseEntityIds:[],algorithmVersion:"horus-case-graph-v1",humanReviewRequired:true});
  const nodes=await initDb().query(`
   WITH RECURSIVE walk(id,d) AS (
    SELECT unnest($3::text[]),0
    UNION
    SELECT CASE WHEN e.source_id=w.id THEN e.target_id ELSE e.source_id END,w.d+1
    FROM walk w JOIN sentinel_edges e ON e.user_id=$1 AND (e.source_id=w.id OR e.target_id=w.id)
    WHERE w.d<$2
   )
   SELECT DISTINCT ON (e.id) e.id,e.entity_type,e.name,e.external_ref,e.metadata
   FROM sentinel_entities e JOIN walk w ON w.id=e.id WHERE e.user_id=$1 ORDER BY e.id LIMIT $4
  `,[u,depth,seedIds,limit]);
  const ids=nodes.rows.map((x:any)=>x.id);
  const edges=ids.length?await initDb().query("SELECT id,source_id,target_id,relation,weight,metadata FROM sentinel_edges WHERE user_id=$1 AND source_id=ANY($2::text[]) AND target_id=ANY($2::text[]) LIMIT 1000",[u,ids]):{rows:[]};
  res.json({caseId,depth,entities:nodes.rows,relationships:edges.rows,caseEntityIds:seedIds,algorithmVersion:"horus-case-graph-v1",humanReviewRequired:true});
 }catch{res.status(500).json({error:"failed to load case graph"})}
});

router.get("/cases/:id/timeline",async(req,res)=>{
 try{
  const u=uid(req),caseId=cleanText(req.params.id,80);
  const from=req.query.from?String(req.query.from):null,to=req.query.to?String(req.query.to):null;
  const eventType=cleanText(req.query.eventType,80),entityId=cleanText(req.query.entityId,80);
  const limit=Math.min(Math.max(Number(req.query.limit)||200,1),200);
  const c0=await initDb().query("SELECT 1 FROM sentinel_cases WHERE id=$1 AND user_id=$2",[caseId,u]);
  if(!c0.rowCount)return res.status(404).json({error:"case not found"});
  const p:any[]=[u,caseId],where=["ev.user_id=$1","ev.entity_id IN (SELECT entity_id FROM sentinel_case_entities WHERE case_id=$2)"];
  if(from&& !Number.isNaN(Date.parse(from))){p.push(from);where.push("ev.occurred_at >= $"+p.length)}
  if(to&& !Number.isNaN(Date.parse(to))){p.push(to);where.push("ev.occurred_at <= $"+p.length)}
  if(eventType){p.push(eventType);where.push("ev.event_type=$"+p.length)}
  if(entityId){p.push(entityId);where.push("ev.entity_id=$"+p.length)}
  p.push(limit);
  const events=await initDb().query("SELECT ev.id,ev.event_type,ev.occurred_at,ev.entity_id,ev.amount,ev.currency,ev.source,e.name AS entity_name FROM sentinel_events ev LEFT JOIN sentinel_entities e ON e.id=ev.entity_id AND e.user_id=ev.user_id WHERE "+where.join(" AND ")+" ORDER BY ev.occurred_at DESC LIMIT $"+p.length,p);
  const total=events.rows.reduce((s:any,x:any)=>s+(x.amount==null?0:Number(x.amount)),0);
  res.json({caseId,filters:{from,to,eventType,entityId},events:events.rows,eventCount:events.rows.length,eventValue:String(total),algorithmVersion:"horus-case-timeline-v1",humanReviewRequired:true});
 }catch{res.status(500).json({error:"failed to load case timeline"})}
});

router.get("/cases/:id",async(req,res)=>{
 try{
  const u=uid(req);
  const c=await initDb().query("SELECT id,title,status,purpose,classification,created_at,updated_at FROM sentinel_cases WHERE id=$1 AND user_id=$2",[req.params.id,u]);
  if(!c.rowCount)return res.status(404).json({error:"case not found"});
  const [entities,alerts,runs,audit]=await Promise.all([
   initDb().query("SELECT e.id,e.entity_type,e.name,e.external_ref,ce.role FROM sentinel_case_entities ce JOIN sentinel_entities e ON e.id=ce.entity_id AND e.user_id=$2 WHERE ce.case_id=$1",[req.params.id,u]),
   initDb().query("SELECT id,alert_type,severity,status,title,summary,rationale,entity_ids,created_at FROM sentinel_alerts WHERE user_id=$1 AND entity_ids ?| ARRAY(SELECT entity_id FROM sentinel_case_entities WHERE case_id=$2)",[u,req.params.id]),
   initDb().query("SELECT id,analysis_type,algorithm_version,input_summary,result_summary,human_review_required,created_at FROM sentinel_analysis_runs WHERE user_id=$1 AND case_id=$2 ORDER BY created_at DESC",[u,req.params.id]),
   initDb().query("SELECT id,action,resource_type,resource_id,purpose,metadata,created_at FROM sentinel_audit_log WHERE user_id=$1 AND resource_id=$2 ORDER BY created_at DESC LIMIT 100",[u,req.params.id])
  ]);
  res.json({case:c.rows[0],entities:entities.rows,alerts:alerts.rows,runs:runs.rows,audit:audit.rows});
 }catch{res.status(500).json({error:"failed to load case workspace"})}
});

router.get("/cases/:id/evidence",async(req,res)=>{
 try{
  const u=uid(req),caseId=cleanText(req.params.id,80);
  const c=await initDb().query("SELECT id,title,status,purpose,classification,created_at,updated_at FROM sentinel_cases WHERE id=$1 AND user_id=$2",[caseId,u]);
  if(!c.rowCount)return res.status(404).json({error:"case not found"});
  const [entities,events,edges,alerts,runs,audit]=await Promise.all([
   initDb().query("SELECT e.id,e.entity_type,e.name,e.external_ref,ce.role FROM sentinel_case_entities ce JOIN sentinel_entities e ON e.id=ce.entity_id AND e.user_id=$2 WHERE ce.case_id=$1 ORDER BY e.name LIMIT 100",[caseId,u]),
   initDb().query("SELECT ev.id,ev.event_type,ev.occurred_at,ev.entity_id,ev.amount,ev.currency,ev.source,e.name AS entity_name FROM sentinel_events ev LEFT JOIN sentinel_entities e ON e.id=ev.entity_id AND e.user_id=ev.user_id WHERE ev.user_id=$1 AND ev.entity_id IN (SELECT entity_id FROM sentinel_case_entities WHERE case_id=$2) ORDER BY ev.occurred_at DESC LIMIT 200",[u,caseId]),
   initDb().query("SELECT id,source_id,target_id,relation,weight,metadata FROM sentinel_edges WHERE user_id=$1 AND (source_id IN (SELECT entity_id FROM sentinel_case_entities WHERE case_id=$2) OR target_id IN (SELECT entity_id FROM sentinel_case_entities WHERE case_id=$2)) LIMIT 500",[u,caseId]),
   initDb().query("SELECT id,alert_type,severity,status,title,summary,rationale,entity_ids,created_at FROM sentinel_alerts WHERE user_id=$1 AND entity_ids ?| ARRAY(SELECT entity_id FROM sentinel_case_entities WHERE case_id=$2) ORDER BY created_at DESC LIMIT 100",[u,caseId]),
   initDb().query("SELECT id,analysis_type,algorithm_version,input_summary,result_summary,human_review_required,created_at FROM sentinel_analysis_runs WHERE user_id=$1 AND case_id=$2 ORDER BY created_at DESC LIMIT 100",[u,caseId]),
   initDb().query("SELECT id,actor_id,action,resource_type,resource_id,purpose,metadata,created_at FROM sentinel_audit_log WHERE user_id=$1 AND (resource_id=$2 OR (metadata->>'caseId')=$2) ORDER BY created_at DESC LIMIT 200",[u,caseId])
  ]);
  const ids=entities.rows.map((x:any)=>x.id);
  const neighbors=await initDb().query("SELECT id,entity_type,name,external_ref,metadata FROM sentinel_entities WHERE user_id=$1 AND id IN (SELECT source_id FROM sentinel_edges WHERE user_id=$1 AND target_id=ANY($2::text[]) UNION SELECT target_id FROM sentinel_edges WHERE user_id=$1 AND source_id=ANY($2::text[])) LIMIT 200",[u,ids]);
  res.json({case:c.rows[0],entities:entities.rows,neighbors:neighbors.rows,relationships:edges.rows,events:events.rows,alerts:alerts.rows,runs:runs.rows,audit:audit.rows,algorithmVersion:"horus-evidence-v1",humanReviewRequired:true});
 }catch{res.status(500).json({error:"failed to load case evidence"})}
});

router.post("/analyst",async(req,res)=>{
 const question=cleanText(req.body?.question,600);
 if(!question)return res.status(400).json({error:"question is required"});
 try{
  const u=uid(req);
  const [o,e,v,a]=await Promise.all([
   initDb().query("SELECT COUNT(*)::int count FROM sentinel_entities WHERE user_id=$1",[u]),
   initDb().query("SELECT e.id,e.name,e.entity_type,COUNT(se.id)::int degree FROM sentinel_entities e LEFT JOIN sentinel_edges se ON se.user_id=e.user_id AND(se.source_id=e.id OR se.target_id=e.id) WHERE e.user_id=$1 GROUP BY e.id ORDER BY degree DESC,e.name LIMIT 8",[u]),
   initDb().query("SELECT COUNT(*)::int count,COALESCE(SUM(amount),0)::numeric total FROM sentinel_events WHERE user_id=$1",[u]),
   initDb().query("SELECT COUNT(*)::int count FROM sentinel_alerts WHERE user_id=$1 AND status IN('open','reviewing')",[u])
  ]);
  const top=e.rows.map(x=>x.name+" ("+x.entity_type+", "+x.degree+" vínculos)");
  const answer="A análise estruturada encontrou "+o.rows[0].count+" entidades, "+v.rows[0].count+" eventos e "+a.rows[0].count+" alertas abertos/revisando. A pergunta foi interpretada como análise exploratória; nenhuma inferência de culpa ou crime foi produzida.";
  const evidence=["Pergunta: "+question,"Entidades mais conectadas: "+(top.join("; ")||"nenhuma"),"Valor agregado de eventos: "+String(v.rows[0].total)]; const runId=randomUUID(); await initDb().query("INSERT INTO sentinel_analysis_runs(id,user_id,analysis_type,algorithm_version,input_summary,result_summary) VALUES($1,$2,$3,$4,$5,$6)",[runId,u,"analyst","horus-analyst-v2",json({question}),json({evidence,humanReviewRequired:true})]); await initDb().query("INSERT INTO sentinel_audit_log(id,user_id,actor_id,action,resource_type,resource_id,purpose,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[randomUUID(),u,u,"analyst.query","analysis_run",runId,"structured intelligence analysis",json({algorithmVersion:"horus-analyst-v2",question})]); res.json({answer,evidence,runId,algorithmVersion:"horus-analyst-v2",humanReviewRequired:true});
 }catch{res.status(500).json({error:"analyst failed"});}
});

router.post("/import",async(req,res)=>{
 const sourceName=cleanText(req.body?.sourceName,180)||"synthetic-upload";
 const format=cleanText(req.body?.format,10);
 const raw=String(req.body?.data||"");
 if(!["json","csv"].includes(format)||!raw)return res.status(400).json({error:"sourceName, format and data are required"});
 if(Buffer.byteLength(raw,"utf8")>1_000_000)return res.status(413).json({error:"synthetic import payload exceeds 1MB"});
 try{
  const u=uid(req); let records:any[]=[];
  if(format==="json"){
   const parsed=JSON.parse(raw);
   records=Array.isArray(parsed)?parsed:(Array.isArray(parsed.records)?parsed.records:[]);
  }else{
   const parseCsv=(text:string)=>{
    const rows:string[][]=[];let row:string[]=[],cell="",quoted=false;
    for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];
     if(ch==='"'&&quoted&&next==='"'){cell+='"';i++;continue}
     if(ch==='"'){quoted=!quoted;continue}
     if(ch===','&&!quoted){row.push(cell.trim());cell="";continue}
     if((ch==='\\n'||ch==='\\r')&&!quoted){if(ch==='\\r'&&next==='\\n')i++;row.push(cell.trim());cell="";if(row.some(Boolean))rows.push(row);row=[];continue}
     cell+=ch;
    }
    if(quoted)throw new Error("unterminated csv quote");
    row.push(cell.trim());if(row.some(Boolean))rows.push(row);return rows;
   };
   const rows=parseCsv(raw);
   if(rows.length){const headers=rows[0].map(x=>cleanText(x,80));if(!headers.length||headers.some(h=>!h))throw new Error("invalid csv header");records=rows.slice(1,202).map(vals=>Object.fromEntries(headers.map((h,i)=>[h,vals[i]??""])));}
  }
  if(!Array.isArray(records)||records.length>200)return res.status(413).json({error:"synthetic import limit is 200 records"});
  const id=randomUUID();let accepted=0;
  await withTransaction(async c=>{
   for(const r of records){
    if(!r||typeof r!=="object"||Array.isArray(r))continue;
    const name=cleanText((r as any).name||(r as any).entity_name,180),type=cleanText((r as any).entity_type||(r as any).entityType,40);
    if(name&&["person","company","account","contract","asset","address","vehicle","case","organization"].includes(type)){
      await c.query("INSERT INTO sentinel_entities(id,user_id,entity_type,name,external_ref,metadata) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),u,type,name,cleanText((r as any).external_ref||(r as any).externalRef,120)||null,json({synthetic:true})]);accepted++;
    }
   }
   await c.query("INSERT INTO sentinel_imports(id,user_id,source_name,format,synthetic,row_count,status,metadata) VALUES($1,$2,$3,$4,true,$5,$6,$7)",[id,u,sourceName,format,records.length,accepted===records.length?"completed":accepted?"partial":"rejected",json({parser:"horus-import-v2",accepted})]);
  });
  res.status(201).json({importId:id,rows:records.length,accepted,synthetic:true});
 }catch{res.status(400).json({error:"invalid synthetic import payload"});}
});

router.get("/imports",async(req,res)=>{
 try{const r=await initDb().query("SELECT id,source_name,format,synthetic,row_count,status,created_at FROM sentinel_imports WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",[uid(req)]);res.json({imports:r.rows});}
 catch{res.status(500).json({error:"failed to load imports"});}
});




router.get("/signals/summary",async(req,res)=>{
 try{
  const u=uid(req),db=await initDb();
  const status=cleanText(req.query?.status,20);
  const params:any[]=[u],where=["a.user_id=$1"];
  if(status&&["open","reviewing","dismissed","confirmed"].includes(status)){params.push(status);where.push("a.status=$"+params.length)}
  const r=await db.query(\`SELECT a.id,a.title,a.severity,a.status,a.alert_type,a.created_at,a.entity_ids,a.rationale,
    COALESCE((a.rationale->>'ruleId'),'legacy') AS rule_id,
    COALESCE((a.rationale->>'ruleVersion'),'1') AS rule_version
    FROM sentinel_alerts a WHERE \${where.join(" AND ")} ORDER BY CASE a.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,a.created_at DESC LIMIT 100\`,params);
  res.json({signals:r.rows,algorithmVersion:"horus-signal-summary-v1",humanReviewRequired:true});
 }catch{res.status(500).json({error:"failed to load signal summary"});}
});

router.post("/signals/:id/review",async(req,res)=>{
 const id=cleanText(req.params.id,80),decision=cleanText(req.body?.decision,30),notes=cleanText(req.body?.notes,2000);
 if(!["open","reviewing","dismissed","confirmed"].includes(decision))return res.status(400).json({error:"invalid review status"});
 try{
  const u=uid(req),db=await initDb();
  const r=await db.query("UPDATE sentinel_alerts SET status=$1 WHERE id=$2 AND user_id=$3 RETURNING id,title,status,rationale,entity_ids",[decision,id,u]);
  if(!r.rowCount)return res.status(404).json({error:"signal not found"});
  await db.query("INSERT INTO sentinel_audit_log(id,user_id,actor_id,action,resource_type,resource_id,purpose,metadata) VALUES($1,$2,$2,'signal.reviewed','alert',$3,'human review of assistive signal',$4)",[randomUUID(),u,id,json({decision,notes,algorithmVersion:"horus-signal-review-v1",humanReviewRequired:true})]);
  res.json({signal:r.rows[0],review:{decision,notes},algorithmVersion:"horus-signal-review-v1",humanReviewRequired:true});
 }catch{res.status(500).json({error:"failed to review signal"});}
});

router.get("/cases/:id/correlation",async(req,res)=>{
 try{
  const u=uid(req),caseId=cleanText(req.params.id,80),windowHours=Math.min(Math.max(Number(req.query.windowHours)||48,1),720),limit=Math.min(Math.max(Number(req.query.limit)||100,1),100),db=await initDb();
  const check=await db.query("SELECT id,title,status,purpose,classification FROM sentinel_cases WHERE id=$1 AND user_id=$2",[caseId,u]);
  if(!check.rowCount)return res.status(404).json({error:"case not found"});
  const entities=(await db.query("SELECT entity_id FROM sentinel_case_entities WHERE case_id=$1",[caseId])).rows.map(x=>x.entity_id);
  if(!entities.length)return res.json({case:check.rows[0],caseEntityIds:[],correlations:[],windowHours,counts:{signals:0,events:0,relationships:0,temporal:0,intersections:0},algorithmVersion:"horus-correlation-v2",humanReviewRequired:true});
  const [signals,events,rel]=await Promise.all([
   db.query("SELECT a.id,a.title,a.severity,a.status,a.created_at,a.entity_ids,a.rationale FROM sentinel_alerts a WHERE a.user_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(a.entity_ids) x WHERE x=ANY($2::text[])) ORDER BY a.created_at DESC LIMIT 100",[u,entities]),
   db.query("SELECT ev.id,ev.event_type,ev.occurred_at,ev.entity_id,ev.amount,ev.currency,ev.source FROM sentinel_events ev WHERE ev.user_id=$1 AND ev.entity_id=ANY($2::text[]) AND ev.occurred_at>=now()-($3 * interval '1 hour') ORDER BY ev.occurred_at DESC LIMIT 300",[u,entities,windowHours]),
   db.query("SELECT e.id,e.source_id,e.target_id,e.relation,e.weight FROM sentinel_edges e WHERE e.user_id=$1 AND (e.source_id=ANY($2::text[]) OR e.target_id=ANY($2::text[])) ORDER BY e.weight DESC NULLS LAST LIMIT 200",[u,entities])
  ]);
  const correlations:any[]=[];
  const eventRows=[...events.rows].sort((x:any,y:any)=>Date.parse(x.occurred_at)-Date.parse(y.occurred_at));
  const byEntity=new Map<string,any[]>();
  for(const ev of eventRows){const list=byEntity.get(ev.entity_id)||[];list.push(ev);byEntity.set(ev.entity_id,list);}
  for(const [entityId,list] of byEntity){
   for(let i=1;i<list.length;i++){
    const prev=list[i-1],cur=list[i],delta=Math.max(0,(Date.parse(cur.occurred_at)-Date.parse(prev.occurred_at))/3600000);
    if(delta<=windowHours){
     const proximity=Math.max(0,1-delta/windowHours),score=Math.min(100,45+Math.round(proximity*35)+Math.min(20,list.length*3));
     correlations.push({type:"temporal_sequence",title:"Sequência temporal de eventos",reason:"Dois eventos consecutivos da mesma entidade ocorreram dentro da janela configurada.",relevanceScore:score,entityId,occurredAt:cur.occurred_at,evidence:{eventIds:[prev.id,cur.id],deltaHours:Number(delta.toFixed(2)),eventCount:list.length}});
    }
   }
  }
  for(const edge of rel.rows){
   const eventHits=eventRows.filter((ev:any)=>ev.entity_id===edge.source_id||ev.entity_id===edge.target_id).slice(-5);
   if(eventHits.length){
    const score=Math.min(100,55+Math.min(25,eventHits.length*5)+Math.min(20,Number(edge.weight||1)*2));
    correlations.push({type:"event_relationship_intersection",title:"Evento conectado a relacionamento",reason:"Eventos do caso intersectam uma relação estrutural registrada no grafo.",relevanceScore:score,relation:edge.relation,evidence:{relationshipId:edge.id,eventIds:eventHits.map((x:any)=>x.id),entityIds:[edge.source_id,edge.target_id]}});
   }
  }
  const signalEntitySets=signals.rows.map((s:any)=>({s,ids:Array.isArray(s.entity_ids)?s.entity_ids:[]}));
  for(const item of signalEntitySets){
   const overlap=item.ids.filter((id:string)=>entities.includes(id));
   if(overlap.length>=1){
    const sev=item.s.severity==="high"?25:item.s.severity==="medium"?15:8;
    correlations.push({type:"signal_evidence_overlap",title:"Sinal com evidência no caso",reason:"Um sinal existente compartilha entidade(s) com o escopo desta investigação.",relevanceScore:Math.min(100,50+sev+overlap.length*5),severity:item.s.severity,status:item.s.status,evidence:{alertId:item.s.id,entityIds:overlap,rationale:item.s.rationale}});
   }
  }
  correlations.sort((x,y)=>(y.relevanceScore||0)-(x.relevanceScore||0));
  const limited=correlations.slice(0,limit);
  await db.query("INSERT INTO sentinel_analysis_runs(id,user_id,case_id,analysis_type,algorithm_version,input_summary,result_summary,human_review_required) VALUES($1,$2,$3,'case_correlation','horus-correlation-v2',$4,$5,true)",[randomUUID(),u,caseId,json({entityCount:entities.length,windowHours,eventCount:events.rowCount,relationshipCount:rel.rowCount,signalCount:signals.rowCount}),json({correlations:limited.length,temporal:limited.filter(x=>x.type==="temporal_sequence").length,intersections:limited.filter(x=>x.type==="event_relationship_intersection").length,signalOverlap:limited.filter(x=>x.type==="signal_evidence_overlap").length})]);
  await db.query("INSERT INTO sentinel_audit_log(id,user_id,actor_id,action,resource_type,resource_id,purpose,metadata) VALUES($1,$2,$2,'case.correlation','case',$3,'contextual evidence correlation',$4)",[randomUUID(),u,caseId,json({algorithmVersion:"horus-correlation-v2",windowHours,correlationCount:limited.length,humanReviewRequired:true})]);
  res.json({case:check.rows[0],caseEntityIds:entities,correlations:limited,windowHours,counts:{signals:signals.rowCount,events:events.rowCount,relationships:rel.rowCount,temporal:limited.filter(x=>x.type==="temporal_sequence").length,intersections:limited.filter(x=>x.type==="event_relationship_intersection").length},algorithmVersion:"horus-correlation-v2",humanReviewRequired:true,disclaimer:"Correlação contextual para revisão humana; relevância técnica não é probabilidade, culpa ou conclusão investigativa."});
 }catch{res.status(500).json({error:"failed to correlate case evidence"})}
});

router.get("/rules",async(req,res)=>{
 try{
  const r=await initDb().query("SELECT id,name,description,enabled,version,kind,severity,definition,created_at,updated_at FROM sentinel_rules WHERE user_id=$1 ORDER BY created_at DESC",[uid(req)]);
  res.json({rules:r.rows,algorithmVersion:"horus-rules-v1"});
 }catch{res.status(500).json({error:"failed to load rules"});}
});

router.post("/rules",async(req,res)=>{
 const name=cleanText(req.body?.name,120),description=cleanText(req.body?.description,500),kind=cleanText(req.body?.kind,60);
 const severity=cleanText(req.body?.severity,20)||"medium",definition=req.body?.definition;
 if(!name||!RULE_KINDS.includes(kind as any)||!RULE_SEVERITIES.includes(severity as any)||!definition||typeof definition!=="object"||Array.isArray(definition))
  return res.status(400).json({error:"invalid rule definition"});
 try{
  const id=randomUUID(),u=uid(req);
  await initDb().query("INSERT INTO sentinel_rules(id,user_id,name,description,enabled,version,kind,severity,definition) VALUES($1,$2,$3,$4,true,1,$5,$6,$7)",[id,u,name,description,kind,severity,json(definition)]);
  await initDb().query("INSERT INTO sentinel_audit_log(id,user_id,actor_id,action,resource_type,resource_id,purpose,metadata) VALUES($1,$2,$2,'rule.created','rule',$3,'configure assistive screening',$4)",[randomUUID(),u,id,json({algorithmVersion:"horus-rules-v1",kind})]);
  res.status(201).json({id,algorithmVersion:"horus-rules-v1"});
 }catch{res.status(500).json({error:"failed to create rule"});}
});

router.patch("/rules/:id",async(req,res)=>{
 const id=cleanText(req.params.id,80),u=uid(req);
 const enabled=req.body?.enabled;
 if(typeof enabled!=="boolean")return res.status(400).json({error:"enabled must be boolean"});
 try{
  const r=await initDb().query("UPDATE sentinel_rules SET enabled=$1,updated_at=now() WHERE id=$2 AND user_id=$3 RETURNING id,enabled,version",[enabled,id,u]);
  if(!r.rowCount)return res.status(404).json({error:"rule not found"});
  await initDb().query("INSERT INTO sentinel_audit_log(id,user_id,actor_id,action,resource_type,resource_id,purpose,metadata) VALUES($1,$2,$2,'rule.updated','rule',$3,'configure assistive screening',$4)",[randomUUID(),u,id,json({enabled})]);
  res.json({rule:r.rows[0],algorithmVersion:"horus-rules-v1"});
 }catch{res.status(500).json({error:"failed to update rule"});}
});

router.post("/rules/evaluate",async(req,res)=>{
 const u=uid(req);
 try{
  const db=await initDb(),rules=(await db.query("SELECT id,name,description,version,kind,severity,definition FROM sentinel_rules WHERE user_id=$1 AND enabled=true ORDER BY created_at",[u])).rows;
  let generated=0,candidates=0;
  for(const rule of rules){
   const def=rule.definition||{};
   if(rule.kind==="degree_threshold"){
    const threshold=Math.max(1,Math.min(100,Number(def.threshold)||5));
    const q=await db.query("SELECT e.id,e.name,COUNT(ed.id)::int AS degree FROM sentinel_entities e LEFT JOIN sentinel_edges ed ON ed.user_id=e.user_id AND (ed.source_id=e.id OR ed.target_id=e.id) WHERE e.user_id=$1 GROUP BY e.id,e.name HAVING COUNT(ed.id)>=$2 ORDER BY degree DESC LIMIT 50",[u,threshold]);
    candidates+=q.rowCount;
    for(const row of q.rows){
     const title=rule.name+": "+row.name;
     const exists=await db.query("SELECT 1 FROM sentinel_alerts WHERE user_id=$1 AND title=$2 AND status IN ('open','reviewing') LIMIT 1",[u,title]);
     if(!exists.rowCount){await db.query("INSERT INTO sentinel_alerts(id,user_id,alert_type,severity,status,title,summary,rationale,entity_ids) VALUES($1,$2,'rule_signal',$3,'open',$4,$5,$6,$7)",[randomUUID(),u,rule.severity,title,"Entity connected to "+row.degree+" relationship(s).",json({ruleId:rule.id,ruleVersion:rule.version,kind:rule.kind,threshold,evidence:{degree:row.degree},humanReviewRequired:true,algorithmVersion:"horus-rules-v1"}),json([row.id])]);generated++;}
    }
   } else if(rule.kind==="event_frequency"||rule.kind==="temporal_burst"){
    const days=Math.max(1,Math.min(365,Number(def.windowDays)||30)),minimum=Math.max(2,Math.min(1000,Number(def.minimumEvents)||5));
    const q=await db.query("SELECT e.id,e.name,COUNT(ev.id)::int AS event_count FROM sentinel_entities e JOIN sentinel_events ev ON ev.user_id=e.user_id AND ev.entity_id=e.id AND ev.occurred_at>=now()-($2 * interval '1 day') WHERE e.user_id=$1 GROUP BY e.id,e.name HAVING COUNT(ev.id)>=$3 ORDER BY event_count DESC LIMIT 50",[u,days,minimum]);
    candidates+=q.rowCount;
    for(const row of q.rows){
     const title=rule.name+": "+row.name;
     const exists=await db.query("SELECT 1 FROM sentinel_alerts WHERE user_id=$1 AND title=$2 AND status IN ('open','reviewing') LIMIT 1",[u,title]);
     if(!exists.rowCount){await db.query("INSERT INTO sentinel_alerts(id,user_id,alert_type,severity,status,title,summary,rationale,entity_ids) VALUES($1,$2,'rule_signal',$3,'open',$4,$5,$6,$7)",[randomUUID(),u,rule.severity,title,"Entity recorded "+row.event_count+" event(s) in the configured window.",json({ruleId:rule.id,ruleVersion:rule.version,kind:rule.kind,windowDays:days,minimumEvents:minimum,evidence:{eventCount:row.event_count},humanReviewRequired:true,algorithmVersion:"horus-rules-v1"}),json([row.id])]);generated++;}
    }
   } else if(rule.kind==="amount_threshold"){
    const minimum=Math.max(0,Number(def.minimumAmount)||100000);
    const q=await db.query("SELECT e.id,e.name,ev.id AS event_id,ev.amount,ev.currency,ev.occurred_at FROM sentinel_events ev JOIN sentinel_entities e ON e.id=ev.entity_id AND e.user_id=ev.user_id WHERE ev.user_id=$1 AND ev.amount>=$2 ORDER BY ev.amount DESC LIMIT 50",[u,minimum]);
    candidates+=q.rowCount;
    for(const row of q.rows){
     const title=rule.name+": "+row.name;
     const exists=await db.query("SELECT 1 FROM sentinel_alerts WHERE user_id=$1 AND title=$2 AND status IN ('open','reviewing') LIMIT 1",[u,title]);
     if(!exists.rowCount){await db.query("INSERT INTO sentinel_alerts(id,user_id,alert_type,severity,status,title,summary,rationale,entity_ids) VALUES($1,$2,'rule_signal',$3,'open',$4,$5,$6,$7)",[randomUUID(),u,rule.severity,title,"Event amount meets or exceeds the configured threshold.",json({ruleId:rule.id,ruleVersion:rule.version,kind:rule.kind,minimumAmount:minimum,evidence:{eventId:row.event_id,amount:row.amount,currency:row.currency,occurredAt:row.occurred_at},humanReviewRequired:true,algorithmVersion:"horus-rules-v1"}),json([row.id])]);generated++;}
    }
   } else if(rule.kind==="shared_attribute"){
    const key=cleanText(def.metadataKey,80);
    if(!key)continue;
    const q=await db.query("SELECT metadata->>$2 AS value,COUNT(*)::int AS entity_count,ARRAY_AGG(id) AS entity_ids FROM sentinel_entities WHERE user_id=$1 AND NULLIF(metadata->>$2,'') IS NOT NULL GROUP BY metadata->>$2 HAVING COUNT(*)>=2 ORDER BY entity_count DESC LIMIT 50",[u,key]);
    candidates+=q.rowCount;
    for(const row of q.rows){
     const title=rule.name+": "+row.value;
     const exists=await db.query("SELECT 1 FROM sentinel_alerts WHERE user_id=$1 AND title=$2 AND status IN ('open','reviewing') LIMIT 1",[u,title]);
     if(!exists){await db.query("INSERT INTO sentinel_alerts(id,user_id,alert_type,severity,status,title,summary,rationale,entity_ids) VALUES($1,$2,'rule_signal',$3,'open',$4,$5,$6,$7)",[randomUUID(),u,rule.severity,title,"Multiple entities share the configured metadata attribute.",json({ruleId:rule.id,ruleVersion:rule.version,kind:rule.kind,metadataKey:key,evidence:{value:row.value,entityCount:row.entity_count},humanReviewRequired:true,algorithmVersion:"horus-rules-v1"}),json(row.entity_ids||[])]);generated++;}
    }
   }
  }
  await db.query("INSERT INTO sentinel_audit_log(id,user_id,actor_id,action,resource_type,purpose,metadata) VALUES($1,$2,$2,'rules.evaluated','rule_engine','run assistive screening',$3)",[randomUUID(),u,json({ruleCount:rules.length,candidates,generated,algorithmVersion:"horus-rules-v1",humanReviewRequired:true})]);
  res.json({rulesEvaluated:rules.length,candidates,generated,algorithmVersion:"horus-rules-v1",humanReviewRequired:true,disclaimer:"Regras produzem sinais para revisão humana; não constituem prova de irregularidade, crime ou responsabilidade."});
 }catch(e){res.status(500).json({error:"failed to evaluate rules"});}
});

router.get("/scenarios",(_req,res)=>{
 res.json({scenarios:[
  {id:"procurement_network",name:"Rede de contratação",description:"Empresas, contrato, pessoas e contas sintéticas conectadas para explorar vínculos."},
  {id:"layered_transfers",name:"Transferências em camadas",description:"Eventos sintéticos em sequência entre contas para explorar padrões temporais."},
  {id:"repeated_contracting",name:"Contratação recorrente",description:"Eventos de contratos repetidos para explorar concentração e frequência."}
 ]});
});

router.post("/scenarios/:id/run",async(req,res)=>{
 const id=cleanText(req.params.id,60);
 if(!["procurement_network","layered_transfers","repeated_contracting"].includes(id))return res.status(404).json({error:"scenario not found"});
 try{
  const u=uid(req);
  await withTransaction(async c=>{
   const a=randomUUID(),b=randomUUID(),c1=randomUUID(),acct1=randomUUID(),acct2=randomUUID(),p=randomUUID();
   const companyNames=id==="procurement_network"?["Atlas Obras Sintéticas","Horizonte Infra Sintética"]:["Operadora Sintética A","Operadora Sintética B"];
   for(const [eid,type,name] of [[a,"company",companyNames[0]],[b,"company",companyNames[1]],[c1,"contract","Contrato Sintético"],[acct1,"account","Conta Sintética A"],[acct2,"account","Conta Sintética B"],[p,"person","Responsável Sintético"]] as any[])
    await c.query("INSERT INTO sentinel_entities(id,user_id,entity_type,name,metadata) VALUES($1,$2,$3,$4,$5)",[eid,u,type,name,json({synthetic:true,scenario:id})]);
   for(const [s,t,r] of [[p,a,"owns"],[a,c1,"contractor"],[b,c1,"related_party"],[a,acct1,"controls"],[b,acct2,"controls"],[acct1,acct2,"transfer_link"]] as any[])
    await c.query("INSERT INTO sentinel_edges(id,user_id,source_id,target_id,relation,metadata) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),u,s,t,r,json({synthetic:true,scenario:id})]);
   for(let i=0;i<12;i++) await c.query("INSERT INTO sentinel_events(id,user_id,event_type,occurred_at,entity_id,amount,currency,source,metadata) VALUES($1,$2,$3,now()-make_interval(days=>$4),$5,$6,'BRL','synthetic-scenario',$7)",[randomUUID(),u,id==="layered_transfers"?"transfer":id==="repeated_contracting"?"contract_payment":"procurement_payment",i%6, i%2?acct1:a, 5000+(i*1750),json({synthetic:true,scenario:id})]);
  });
  res.status(201).json({scenario:id,synthetic:true,message:"Cenário sintético executado. Nenhum resultado representa conclusão sobre pessoas ou organizações reais."});
 }catch{res.status(500).json({error:"failed to run scenario"});}
});

export default router;
