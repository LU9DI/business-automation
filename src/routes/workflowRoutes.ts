import { Router } from "express";
import { prepareWorkflow } from "../services/workflowService.js";
import { requireAuth } from "../middleware/auth.js";
const router=Router();
router.post("/validate",requireAuth,(req,res)=>{try{res.json({valid:true,workflow:prepareWorkflow(req.body)});}catch(e){res.status(400).json({valid:false,error:e instanceof Error?e.message:"invalid workflow"});}});
export default router;
