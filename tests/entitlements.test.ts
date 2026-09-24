import test from "node:test";
import assert from "node:assert/strict";
import { assertEntitlement, type Entitlement } from "../src/core/platformGovernance.js";
const e=(plan:string,limit:number|null,allowed=true):Entitlement=>({plan,limit,allowed});
test("plan entitlement matrix enforces automation limits",()=>{assert.doesNotThrow(()=>assertEntitlement(e("free",5),"automations",4));assert.throws(()=>assertEntitlement(e("free",5),"automations",5),/limit reached/);assert.doesNotThrow(()=>assertEntitlement(e("pro",100),"automations",99));assert.throws(()=>assertEntitlement(e("pro",100),"automations",100),/limit reached/);assert.doesNotThrow(()=>assertEntitlement(e("business",1000),"automations",999));assert.throws(()=>assertEntitlement(e("business",1000),"automations",1000),/limit reached/);});
test("disabled entitlement is denied",()=>{assert.throws(()=>assertEntitlement(e("free",0,false),"advanced_analytics",0),/feature disabled/);});
