# Constitution — Business Automation

## Purpose
This repository uses Spec-Driven Development (SDD) so product intent, architecture, implementation, tests, and operational verification remain aligned.

## Principles
1. Security first: validate inputs, scope data by tenant/user, never expose secrets, and keep sensitive errors generic.
2. Idempotency by default: automation, payments, webhooks, scheduling, and other retryable mutations must be safe to repeat.
3. Backward compatibility: preserve existing public API contracts unless a feature specification explicitly changes them.
4. Evidence before claims: never call an integration, deployment, or automation complete without reproducible verification.
5. Minimal cost: prefer existing free-tier infrastructure and configured providers; never add paid resources without explicit approval.
6. Personalized acquisition, not spam: outreach must be relevant, rate-limited, suppressible, deduplicated, and auditable.
7. Production safety: migrations are ordered and protected; failures are recoverable; production deploys are verified.
8. Testable requirements: new behavior needs acceptance criteria and an automated test or explicit verification procedure.
9. Clean separation: this product is independent from Filtra.AI. Filtra.AI may be used only as an architectural reference; its code and production resources must not be modified by this repository.
10. Convergence: implement only after the spec/plan/tasks are coherent, then verify code against them before declaring done.

## Current baseline
Workflow engine and connectors, tenant isolation, webhook HMAC/idempotency, redaction, workflow/run limits, pagination, acquisition data model/routes, SEO endpoints/public SEO shell, safe AI/email acquisition adapters, OIDC-protected scheduled acquisition entrypoint, GitHub Actions schedule, Render production deployment.

## Remaining direction
Complete acquisition reporting, bounded retry/recovery, real distribution adapters only for configured integrations, end-to-end workflow/acquisition tests, public frontend/indexable SEO surfaces, final security review, and convergence checks.

## Quality gate
Code existing is not equivalent to completion. A feature is complete only when its requirements, security boundaries, tests, and production verification are satisfied.