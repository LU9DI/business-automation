import { validateWorkflow,type Workflow } from "../domain/workflows.js";
export function prepareWorkflow(w:Workflow){validateWorkflow(w);return {...w,enabled:Boolean(w.enabled)};}
