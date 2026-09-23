export type WorkflowStep={id:string;type:string;config:Record<string,unknown>};
export type Workflow={name:string;enabled:boolean;steps:WorkflowStep[]};
const MAX_NAME=200;
const MAX_STEP_ID=100;
const MAX_CONFIG_BYTES=20000;
export function validateWorkflow(w:Workflow){
  if(!w || typeof w!=="object")throw new Error("invalid workflow");
  if(typeof w.name!=="string"||!w.name.trim()||w.name.trim().length>MAX_NAME)throw new Error("invalid workflow name");
  if(!Array.isArray(w.steps)||w.steps.length>100)throw new Error("invalid workflow steps");
  for(const step of w.steps){
    if(!step||typeof step!=="object"||typeof step.id!=="string"||!step.id.trim()||step.id.length>MAX_STEP_ID)throw new Error("invalid workflow step");
    if(typeof step.type!=="string"||!step.type.trim()||step.type.length>100)throw new Error("invalid workflow connector");
    if(step.config!=null&&(typeof step.config!=="object"||Array.isArray(step.config)))throw new Error("invalid workflow config");
    if(step.config!=null&&JSON.stringify(step.config).length>MAX_CONFIG_BYTES)throw new Error("workflow config too large");
  }
  return true;
}