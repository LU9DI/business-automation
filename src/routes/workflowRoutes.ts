import { Router } from "express"; import { prepareWorkflow } from "../services/workflowService.js";
const router=Router(); router.post("/validate",(req,res)=>{try{res.json({valid:true,workflow:prepareWorkflow(req.body)});}catch(e){res.status(400).json({valid:false,error:e instanceof Error?e.message:"invalid workflow"});}}); export default router;
