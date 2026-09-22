import { Workflow, validateWorkflow } from "../domain/workflows.js";
import { getConnector } from "./connectors.js";
export function prepareWorkflow(input:Workflow):Workflow{if(!input||typeof input!=="object")throw new Error("workflow is required");validateWorkflow(input);return{name:input.name.trim(),enabled:Boolean(input.enabled),steps:input.steps};}
export async function executeWorkflow(workflow:Workflow,input:Record<string,unknown>){
 const outputs:Record<string,unknown>[]=[];let current={...input};
 for(const step of workflow.steps){const type=String(step.type||"").trim();if(!type)throw new Error("workflow step type is required");const connector=getConnector(type);if(!connector)throw new Error("unsupported connector: "+type);current={...current,...(await connector.execute({input:current,config:step.config||{}})).data};outputs.push({stepId:step.id,type,status:"succeeded",data:current});}
 return{status:"succeeded" as const,output:{final:current,steps:outputs}};
}