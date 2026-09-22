export type WorkflowStep={id:string;type:string;config:Record<string,unknown>};
export type Workflow={name:string;enabled:boolean;steps:WorkflowStep[]};
export function validateWorkflow(w:Workflow){if(!w.name?.trim())throw new Error("workflow name is required");if(!Array.isArray(w.steps)||w.steps.length>100)throw new Error("invalid workflow steps");return true}
