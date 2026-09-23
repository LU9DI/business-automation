# Baseline and Product Roadmap — Business Automation

## Status
Initial Spec Kit baseline for an existing codebase. It records verified work already present and establishes bounded future work; it is not a retroactive specification of every historical implementation detail.

## What has already been done
Workflow engine and connectors, tenant isolation, webhook HMAC/idempotency, redaction, workflow/run limits, pagination, acquisition data model/routes, SEO endpoints/public SEO shell, safe AI/email acquisition adapters, OIDC-protected scheduled acquisition entrypoint, GitHub Actions schedule, Render production deployment.

## What must still be done
Complete acquisition reporting, bounded retry/recovery, real distribution adapters only for configured integrations, end-to-end workflow/acquisition tests, public frontend/indexable SEO surfaces, final security review, and convergence checks.

## Functional requirements
- FR-001: Existing APIs preserve tenant/user authorization boundaries.
- FR-002: Retryable mutations remain idempotent.
- FR-003: Acquisition supports deduplication, suppression, cooldowns, and auditable lifecycle events.
- FR-004: Scheduled automation authenticates its caller and does not require an unapproved paid scheduler.
- FR-005: Reporting distinguishes researched, selected, scheduled, executed, delivered/published, and failed states.
- FR-006: Transient failures are recoverable with bounded retries and no duplicate side effects.
- FR-007: Public SEO routes do not expose private application/API surfaces.
- FR-008: Stored automation output and errors do not leak secrets.
- FR-009: Production changes have deployment/runtime evidence before being reported as live.
- FR-010: Product-specific legal/business claims are verified before publication where applicable.

## Acceptance criteria
- Duplicate automation requests do not create duplicate side effects.
- Suppressed or recently contacted leads are not contacted again.
- Scheduled automation can run without creating an unapproved paid resource.
- Failures are observable and transient failures are retried within explicit limits.
- Reports expose enough data to diagnose throughput, delivery, publication, and failures.
- Public SEO URLs expose valid metadata while private routes remain non-indexable.
- Tests cover authorization, idempotency, validation, suppression, and principal automation paths.
- Production deployment/runtime status is verified after production-impacting changes.

## Out of scope
- Rewriting the whole application.
- Any modification to Filtra.AI.
- New paid infrastructure without approval.
- Unsupported legal, tax, financial, marketplace, or product claims.

## Traceability
Create future bounded features under specs/###-feature-name/; do not turn this baseline into an ever-growing feature specification.