import { Router } from "express";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { initDb } from "../core/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function recordActivity(userId:string,eventType:string,entityType?:string,entityId?:string,metadata:Record<string,unknown>={}) {
  try {
    await initDb().query(
      "INSERT INTO user_activity (id,user_id,event_type,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6)",
      [randomUUID(),userId,eventType,entityType??null,entityId??null,JSON.stringify(metadata)]
    );
  } catch {}
}

export async function notifyUser(userId:string,title:string,body:string,type="system") {
  try {
    await initDb().query(
      "INSERT INTO user_notifications (id,user_id,type,title,body) VALUES ($1,$2,$3,$4,$5)",
      [randomUUID(),userId,type,title,body]
    );
  } catch {}
}

router.get("/me",requireAuth,async(req,res)=>{
  try {
    const r=await initDb().query(
      "SELECT id,email,display_name,timezone,locale,plan,trial_ends_at,created_at,updated_at FROM app_users WHERE id=$1",
      [(req as any).userId]
    );
    if(!r.rowCount)return res.status(404).json({error:"user not found"});
    res.json({user:r.rows[0]});
  } catch { res.status(500).json({error:"failed to load account"}); }
});

router.patch("/me",requireAuth,async(req,res)=>{
  try {
    const body=req.body||{};
    const displayName=body.displayName==null?null:String(body.displayName).trim().slice(0,120)||null;
    const timezone=body.timezone==null?"America/Sao_Paulo":String(body.timezone).trim().slice(0,80);
    const locale=body.locale==null?"pt-BR":String(body.locale).trim().slice(0,20);
    const email=body.email==null?undefined:String(body.email).trim().toLowerCase();
    if(email!==undefined&&!/^\S+@\S+\.\S+$/.test(email))return res.status(400).json({error:"invalid email"});
    const r=await initDb().query(
      "UPDATE app_users SET display_name=$1,timezone=$2,locale=$3,email=COALESCE($4,email),updated_at=now() WHERE id=$5 RETURNING id,email,display_name,timezone,locale,plan,trial_ends_at,created_at,updated_at",
      [displayName,timezone,locale,email??null,(req as any).userId]
    );
    if(!r.rowCount)return res.status(404).json({error:"user not found"});
    await recordActivity((req as any).userId,"account.updated","user",(req as any).userId,{fields:["display_name","timezone","locale","email"]});
    await notifyUser((req as any).userId,"Conta atualizada","Suas preferências foram salvas.","account");
    res.json({user:r.rows[0]});
  } catch(error:any) {
    if(error?.code==="23505")return res.status(409).json({error:"email already registered"});
    res.status(500).json({error:"failed to update account"});
  }
});

router.post("/password",requireAuth,async(req,res)=>{
  try {
    const current=String(req.body?.currentPassword??""), next=String(req.body?.newPassword??"");
    if(next.length<10)return res.status(400).json({error:"new password must have at least 10 characters"});
    const r=await initDb().query("SELECT password_hash FROM app_users WHERE id=$1",[(req as any).userId]);
    if(!r.rowCount||!(await bcrypt.compare(current,r.rows[0].password_hash)))return res.status(401).json({error:"current password is incorrect"});
    const hash=await bcrypt.hash(next,12);
    await initDb().query("UPDATE app_users SET password_hash=$1,updated_at=now() WHERE id=$2",[hash,(req as any).userId]);
    await recordActivity((req as any).userId,"account.password_changed","user",(req as any).userId);
    await notifyUser((req as any).userId,"Senha alterada","Sua senha foi alterada com sucesso.","security");
    res.json({ok:true});
  } catch { res.status(500).json({error:"failed to change password"}); }
});

router.get("/notifications",requireAuth,async(req,res)=>{
  try {
    const limit=Math.min(Math.max(Number(req.query.limit)||20,1),100);
    const r=await initDb().query("SELECT id,type,title,body,read_at,created_at FROM user_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",[(req as any).userId,limit]);
    const unread=await initDb().query("SELECT COUNT(*)::int count FROM user_notifications WHERE user_id=$1 AND read_at IS NULL",[(req as any).userId]);
    res.json({notifications:r.rows,unread:Number(unread.rows[0].count)});
  } catch { res.status(500).json({error:"failed to load notifications"}); }
});

router.patch("/notifications/:id/read",requireAuth,async(req,res)=>{
  if(!UUID.test(String(req.params.id)))return res.status(400).json({error:"invalid notification id"});
  try {
    const r=await initDb().query("UPDATE user_notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id,read_at",[req.params.id,(req as any).userId]);
    if(!r.rowCount)return res.status(404).json({error:"notification not found"});
    res.json({notification:r.rows[0]});
  } catch { res.status(500).json({error:"failed to update notification"}); }
});

router.post("/notifications/read-all",requireAuth,async(req,res)=>{
  try {
    const r=await initDb().query("UPDATE user_notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL",[(req as any).userId]);
    res.json({ok:true,updated:r.rowCount});
  } catch { res.status(500).json({error:"failed to mark notifications"}); }
});

router.get("/activity",requireAuth,async(req,res)=>{
  try {
    const limit=Math.min(Math.max(Number(req.query.limit)||30,1),100);
    const r=await initDb().query("SELECT id,event_type,entity_type,entity_id,metadata,created_at FROM user_activity WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",[(req as any).userId,limit]);
    res.json({activity:r.rows});
  } catch { res.status(500).json({error:"failed to load activity"}); }
});

export default router;
