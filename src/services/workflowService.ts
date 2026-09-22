import { Workflow, validateWorkflow } from "../domain/workflows.js";

export function prepareWorkflow(input: Workflow): Workflow {
  if (!input || typeof input !== "object") throw new Error("workflow is required");
  validateWorkflow(input);
  return { name: input.name.trim(), enabled: Boolean(input.enabled), steps: input.steps };
}

export function executeWorkflow(workflow: Workflow, input: Record<string, unknown>) {
  const outputs: Record<string, unknown>[] = [];
  let current: Record<string, unknown> = { ...input };
  for (const step of workflow.steps) {
    const type = String(step.type || "").trim();
    if (!type) throw new Error("workflow step type is required");
    current = { ...current, lastStep: step.id, lastStepType: type };
    outputs.push({ stepId: step.id, type, status: "simulated", data: current });
  }
  return { status: "succeeded" as const, output: { final: current, steps: outputs } };
}