import {Router} from "express"; import {issueToken} from "../core/auth.js";
const router=Router();
router.post("/token",(req,res)=>{const id=String(req.body?.userId||"").trim();if(!id)return res.status(400).json({error:"userId is required"});try{res.json({token:issueToken(id)});}catch(e){res.status(500).json({error:e instanceof Error?e.message:"auth error"});}});
export default router;
