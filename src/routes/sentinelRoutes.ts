import { Router } from "express";
import { randomUUID } from "node:crypto";
import { initDb, withTransaction } from "../core/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
const uid=(req:any)=>String(req.userId);
const json=(v:unknown)=>JSON.stringify(v??{});
const clean=(v:unknown,max=180)=>String(v??"").trim().slice(0,max);

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

router.get("/entities/:id/evidence",async(req,res)=>{
 try{
  const u=uid(req),id=clean(req.params.id,80);
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
 const b=req.body||{},n=clean(b.name),t=clean(b.entityType),ok=["person","company","account","contract","asset","address","vehicle","case","organization"];
 if(!n||!ok.includes(t))return res.status(400).json({error:"name and valid entityType are required"});
 try{const id=randomUUID();await initDb().query("INSERT INTO sentinel_entities(id,user_id,entity_type,name,external_ref,metadata) VALUES($1,$2,$3,$4,$5,$6)",[id,uid(req),t,n,clean(b.externalRef,120)||null,json(b.metadata)]);res.status(201).json({entity:{id,name:n,entity_type:t}})}catch{res.status(500).json({error:"failed to create entity"})}
});

router.post("/relationships",async(req,res)=>{
 const b=req.body||{},s=clean(b.sourceId,80),t=clean(b.targetId,80),rel=clean(b.relation,100);
 if(!s||!t||!rel||s===t)return res.status(400).json({error:"sourceId, targetId and relation are required"});
 try{const r=await initDb().query("INSERT INTO sentinel_edges(id,user_id,source_id,target_id,relation,weight,metadata) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM sentinel_entities WHERE id=$3 AND user_id=$2) AND EXISTS(SELECT 1 FROM sentinel_entities WHERE id=$4 AND user_id=$2) ON CONFLICT(user_id,source_id,target_id,relation) DO UPDATE SET weight=sentinel_edges.weight+EXCLUDED.weight,metadata=EXCLUDED.metadata RETURNING id,source_id,target_id,relation,weight",[randomUUID(),uid(req),s,t,rel,Number(b.weight)||1,json(b.metadata)]);if(!r.rowCount)return res.status(404).json({error:"entities not found in your workspace"});res.status(201).json({relationship:r.rows[0]})}catch{res.status(500).json({error:"failed to create relationship"})}
});

router.post("/events",async(req,res)=>{
 const b=req.body||{},type=clean(b.eventType,80),occurred=String(b.occurredAt||"");
 if(!type||!occurred||Number.isNaN(Date.parse(occurred)))return res.status(400).json({error:"eventType and valid occurredAt are required"});
 try{const id=randomUUID(),entity=b.entityId?clean(b.entityId,80):null;const r=await initDb().query("INSERT INTO sentinel_events(id,user_id,event_type,occurred_at,entity_id,amount,currency,source,metadata) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE $5 IS NULL OR EXISTS(SELECT 1 FROM sentinel_entities WHERE id=$5 AND user_id=$2) RETURNING id,event_type,occurred_at,entity_id,amount,currency,source",[id,uid(req),type,occurred,entity,b.amount==null?null:Number(b.amount),clean(b.currency,10)||null,clean(b.source,60)||"manual",json(b.metadata)]);if(!r.rowCount)return res.status(404).json({error:"entity not found in your workspace"});res.status(201).json({event:r.rows[0]})}catch{res.status(500).json({error:"failed to create event"})}
});

router.post("/demo-data",async(req,res)=>{
 try{const u=uid(req);const out=await withTransaction(async c=>{const ids=Object.fromEntries(["companyA","companyB","personX","personY","contract1","account1","account2"].map(k=>[k,randomUUID()]));const es=[[ids.companyA,"company","Orion Serviços Ltda"],[ids.companyB,"company","Nova Horizonte Participações"],[ids.personX,"person","Pessoa Exemplo A"],[ids.personY,"person","Pessoa Exemplo B"],[ids.contract1,"contract","Contrato público demonstrativo"],[ids.account1,"account","Conta demonstrativa 001"],[ids.account2,"account","Conta demonstrativa 002"]];for(const [id,type,name] of es)await c.query("INSERT INTO sentinel_entities(id,user_id,entity_type,name,metadata) VALUES($1,$2,$3,$4,$5)",[id,u,type,name,json({synthetic:true})]);const ed=[[ids.personX,ids.companyA,"owns"],[ids.personY,ids.companyB,"owns"],[ids.companyA,ids.companyB,"supplier"],[ids.companyA,ids.contract1,"contractor"],[ids.companyB,ids.contract1,"related_party"],[ids.companyA,ids.account1,"controls"],[ids.companyB,ids.account2,"controls"],[ids.account1,ids.account2,"transfer_link"]];for(const [s,t,r] of ed)await c.query("INSERT INTO sentinel_edges(id,user_id,source_id,target_id,relation,metadata) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),u,s,t,r,json({synthetic:true})]);for(let i=0;i<8;i++)await c.query("INSERT INTO sentinel_events(id,user_id,event_type,occurred_at,entity_id,amount,currency,source,metadata) VALUES($1,$2,$3,now()-make_interval(days=>$4),$5,$6,'BRL','demo',$7)",[randomUUID(),u,i%2?"transfer":"contract_payment",i,i%2?ids.account1:ids.companyA,(i+1)*12500,json({synthetic:true})]);return{entities:es.length,relationships:ed.length,events:8}});res.status(201).json({synthetic:true,...out,message:"Dataset demonstrativo criado. Não representa dados reais nem conclusões investigativas."})}catch{res.status(500).json({error:"failed to create synthetic dataset"})}
});

router.post("/analyze",async(req,res)=>{
 try{const u=uid(req),alerts:any[]=[];const d=await initDb().query("SELECT e.id,e.name,e.entity_type,COUNT(se.id)::int degree FROM sentinel_entities e JOIN sentinel_edges se ON se.user_id=e.user_id AND(se.source_id=e.id OR se.target_id=e.id) WHERE e.user_id=$1 GROUP BY e.id HAVING COUNT(se.id)>=4 ORDER BY degree DESC LIMIT 20",[u]);for(const x of d.rows)alerts.push({type:"dense_relationships",severity:x.degree>=7?"high":"medium",title:"Nó com alta conectividade",summary:"A entidade possui muitas relações no grafo e merece revisão contextual.",rationale:{degree:x.degree,method:"degree_threshold",humanReviewRequired:true},entityIds:[x.id]});const f=await initDb().query("SELECT entity_id,COUNT(*)::int event_count,COALESCE(SUM(amount),0)::numeric total FROM sentinel_events WHERE user_id=$1 AND entity_id IS NOT NULL AND occurred_at>=now()-interval '30 days' GROUP BY entity_id HAVING COUNT(*)>=5 ORDER BY event_count DESC LIMIT 20",[u]);for(const x of f.rows)alerts.push({type:"repeated_activity",severity:+x.event_count>=10?"high":"medium",title:"Atividade repetida concentrada",summary:"Foram observados múltiplos eventos associados à mesma entidade no período analisado.",rationale:{eventCount:+x.event_count,total:String(x.total),window:"30d",method:"frequency_threshold",humanReviewRequired:true},entityIds:[x.entity_id]});let inserted=0;for(const a of alerts){const q=await initDb().query("SELECT 1 FROM sentinel_alerts WHERE user_id=$1 AND alert_type=$2 AND status IN('open','reviewing') AND entity_ids @> $3::jsonb LIMIT 1",[u,a.type,json(a.entityIds)]);if(!q.rowCount){await initDb().query("INSERT INTO sentinel_alerts(id,user_id,alert_type,severity,title,summary,rationale,entity_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[randomUUID(),u,a.type,a.severity,a.title,a.summary,json(a.rationale),json(a.entityIds)]);inserted++}}res.json({generated:inserted,candidates:alerts.length,disclaimer:"Alertas são sinais para análise humana; não constituem prova de crime, lavagem de dinheiro ou irregularidade."})}catch{res.status(500).json({error:"analysis failed"})}
});

router.get("/alerts",async(req,res)=>{try{const status=clean(req.query.status,20),p:any[]=[uid(req)];let sql="SELECT id,alert_type,severity,status,title,summary,rationale,entity_ids,created_at,updated_at FROM sentinel_alerts WHERE user_id=$1";if(status){sql+=" AND status=$2";p.push(status)}sql+=" ORDER BY created_at DESC LIMIT 100";const r=await initDb().query(sql,p);res.json({alerts:r.rows})}catch{res.status(500).json({error:"failed to load alerts"})}});

router.patch("/alerts/:id",async(req,res)=>{const status=clean(req.body?.status,20);if(!["open","reviewing","dismissed","confirmed"].includes(status))return res.status(400).json({error:"invalid status"});try{const r=await initDb().query("UPDATE sentinel_alerts SET status=$1,updated_at=now() WHERE id=$2 AND user_id=$3 RETURNING id,status,updated_at",[status,req.params.id,uid(req)]);if(!r.rowCount)return res.status(404).json({error:"alert not found"});res.json({alert:r.rows[0]})}catch{res.status(500).json({error:"failed to update alert"})}});

router.post("/cases", async (req,res)=>{
  const title=clean(req.body?.title,180), purpose=clean(req.body?.purpose,500);
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
  const entityId=clean(req.body?.entityId,80),role=clean(req.body?.role,80)||"subject_of_analysis";
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
  const caseId=req.body?.caseId?clean(req.body.caseId,80):null;
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
 const from=clean(req.query.from,80),to=clean(req.query.to,80);
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
  const u=uid(req),caseId=clean(req.params.id,80);
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
 const question=clean(req.body?.question,600);
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
 const sourceName=clean(req.body?.sourceName,180)||"synthetic-upload";
 const format=clean(req.body?.format,10);
 const raw=String(req.body?.data||"");
 if(!["json","csv"].includes(format)||!raw)return res.status(400).json({error:"sourceName, format and data are required"});
 try{
  const u=uid(req);
  let records:any[]=[];
  if(format==="json"){
   const parsed=JSON.parse(raw);
   records=Array.isArray(parsed)?parsed:(Array.isArray(parsed.records)?parsed.records:[]);
  }else{
   const lines=raw.split(/\r?\n/).filter(Boolean);
   if(lines.length){const headers=lines[0].split(",").map(x=>x.trim());records=lines.slice(1).map(line=>{const vals=line.split(",");return Object.fromEntries(headers.map((h,i)=>[h,vals[i]?.trim()??""]))});}
  }
  if(records.length>200)return res.status(413).json({error:"synthetic import limit is 200 records"});
  const id=randomUUID();
  await withTransaction(async c=>{
   await c.query("INSERT INTO sentinel_imports(id,user_id,source_name,format,synthetic,row_count,metadata) VALUES($1,$2,$3,$4,true,$5,$6)",[id,u,sourceName,format,records.length,json({parser:"sentinel-import-v1"})]);
   for(const r of records){
    const name=clean(r.name||r.entity_name,180), type=clean(r.entity_type||r.entityType,40);
    if(name&&["person","company","account","contract","asset","address","vehicle","case","organization"].includes(type)){
      await c.query("INSERT INTO sentinel_entities(id,user_id,entity_type,name,external_ref,metadata) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),u,type,name,clean(r.external_ref||r.externalRef,120)||null,json({synthetic:true,importId:id})]);
    }
   }
  });
  res.status(201).json({importId:id,rows:records.length,synthetic:true});
 }catch{res.status(400).json({error:"invalid synthetic import payload"});}
});

router.get("/imports",async(req,res)=>{
 try{const r=await initDb().query("SELECT id,source_name,format,synthetic,row_count,status,created_at FROM sentinel_imports WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",[uid(req)]);res.json({imports:r.rows});}
 catch{res.status(500).json({error:"failed to load imports"});}
});

router.get("/scenarios",(_req,res)=>{
 res.json({scenarios:[
  {id:"procurement_network",name:"Rede de contratação",description:"Empresas, contrato, pessoas e contas sintéticas conectadas para explorar vínculos."},
  {id:"layered_transfers",name:"Transferências em camadas",description:"Eventos sintéticos em sequência entre contas para explorar padrões temporais."},
  {id:"repeated_contracting",name:"Contratação recorrente",description:"Eventos de contratos repetidos para explorar concentração e frequência."}
 ]});
});

router.post("/scenarios/:id/run",async(req,res)=>{
 const id=clean(req.params.id,60);
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
