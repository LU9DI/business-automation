---
name: workflow-automation-safety
description: Design safe, observable business workflows with explicit retries and side-effect controls.
---
# Workflow automation safety
- Treat trigger payloads and connector responses as untrusted; validate schema, tenant, and allowed action before execution.
- Separate planning from side effects. Require explicit approval for destructive, financial, external messaging, or irreversible actions unless policy explicitly authorizes them.
- Make runs idempotent with stable event keys; define retry limits, backoff, deadlines, cancellation, and dead-letter handling.
- Prevent duplicate sends or charges with deduplication and transactional outbox patterns where applicable.
- Apply least-privilege connector credentials and tenant-scoped access; never pass secrets into model prompts or logs.
- Record auditable execution metadata while redacting PII and secrets.
- Test replay, partial failure, timeout, cancellation, duplicate triggers, and permission changes.
