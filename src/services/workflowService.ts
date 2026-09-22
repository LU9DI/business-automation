import { Workflow, validateWorkflow } from "../domain/workflows.js";
import { getConnector } from "./connectors.js";

const STEP_TIMEOUT_MS = Math.min(120000, Math.max(5000, Number(process.env.WORKFLOW_STEP_TIMEOUT_MS || 30000)));
const MAX_STEPS = 50;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("workflow step timed out")), ms))
  ]);
}

export function prepareWorkflow(input: Workflow): Workflow {
  if (!input || typeof input !== "object") throw new Error("workflow is required");
  validateWorkflow(input);
  if (input.steps.length > MAX_STEPS) throw new Error(`workflow exceeds maximum of ${MAX_STEPS} steps`);
  return { name: input.name.trim(), enabled: Boolean(input.enabled), steps: input.steps };
}

export async function executeWorkflow(workflow: Workflow, input: Record<string, unknown>) {
  const outputs: Record<string, unknown>[] = [];
  let current = { ...input };

  if (workflow.steps.length > MAX_STEPS) throw new Error(`workflow exceeds maximum of ${MAX_STEPS} steps`);

  for (const step of workflow.steps) {
    const type = String(step.type || "").trim();
    if (!type) throw new Error("workflow step type is required");
    const connector = getConnector(type);
    if (!connector) throw new Error("unsupported connector: " + type);

    const result = await withTimeout(
      connector.execute({ input: current, config: step.config || {} }),
      STEP_TIMEOUT_MS
    );
    current = { ...current, ...(result?.data || {}) };
    outputs.push({ stepId: step.id, type, status: "succeeded", data: current });
  }

  return { status: "succeeded" as const, output: { final: current, steps: outputs } };
}
