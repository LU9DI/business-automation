import { test } from "node:test";
import assert from "node:assert/strict";
import { executeWorkflow } from "../src/services/workflowService.js";
test("executes workflow steps deterministically",async()=>{
 const r=await executeWorkflow({name:"demo",enabled:true,steps:[
  {id:"a",type:"passthrough",config:{}},{id:"b",type:"set_fields",config:{lastStep:"b"}}
 ]},{lead:"x"});
 assert.equal(r.status,"succeeded");assert.equal(r.output.final.lastStep,"b");assert.equal(r.output.steps.length,2);
});