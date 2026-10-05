import { test } from "node:test";
import assert from "node:assert/strict";
import { validateWorkflow } from "../src/domain/workflows.js";
test("validates workflow steps",()=>{assert.equal(validateWorkflow({name:"x",enabled:true,steps:[{id:"1",type:"email",config:{}}]}),true);assert.throws(()=>validateWorkflow({name:"",enabled:true,steps:[]}));});
