# Tasks — Baseline

## Phase 1 — Governance
- [ ] T001 Keep constitution synchronized with real repository constraints.
- [ ] T002 Create a bounded feature spec before each significant implementation.
- [ ] T003 Run clarify/checklist/analyze for ambiguous or production-impacting features.

## Phase 2 — Acquisition completion
- [x] T004 Audit and expand the acquisition funnel/report: leads, outreach, delivery/publication, failures, retries, and conversion signals.
- [x] T005 — Implement bounded retry/recovery for retryable outreach failures: max 3 attempts, backoff, idempotency, no duplicate send, and exhaustion events. Production deploy verified live.
- [ ] T006 Add distribution adapters only for verified/configured integrations.
- [ ] T007 Add end-to-end tests for acquisition idempotency, cooldown, suppression, provider fallback, and failure handling.

## Phase 3 — Product quality
- [x] T014 Enforce workflow concurrency/daily execution limits on direct and webhook execution paths.
- [x] T015 Serialize webhook admission per user so concurrent requests cannot bypass execution limits; keep idempotency inside the same transaction.
- [ ] T008 Verify public SEO/indexability surfaces and canonical URLs.
- [ ] T009 Run a focused security review of outbound integrations and webhook/scheduler boundaries.
- [x] T010 Verify production deployment/runtime behavior after each release.

## Phase 4 — Convergence
- [ ] T011 Run Spec Kit consistency analysis across spec/plan/tasks.
- [ ] T012 Implement remaining gaps identified by convergence.
- [ ] T013 Repeat converge until the feature is actually complete.

## Constraint
Do not modify Filtra.AI while executing these tasks.