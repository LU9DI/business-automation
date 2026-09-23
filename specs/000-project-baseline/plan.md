# Plan — Business Automation Baseline

## Constitution check
PASS. The baseline preserves tenant isolation, idempotency, security, cost constraints, production verification, and separation from Filtra.AI.

## Existing architecture
- Node/TypeScript backend with Express.
- Neon/Postgres persistence with ordered startup migrations.
- Authenticated APIs with validation, rate limiting, and security headers.
- Acquisition routes and persistence.
- Public SEO endpoints and generated SEO pages.
- AI/email acquisition provider abstraction.
- GitHub Actions scheduled acquisition trigger using GitHub OIDC.
- Render production deployment.

## Implementation strategy
1. Keep the stable foundation unchanged unless a bounded feature requires a targeted modification.
2. Implement acquisition reporting and recovery as small testable slices.
3. Add provider adapters only when configured and backed by a known API contract.
4. Keep retries bounded and idempotent.
5. Test and verify deployment after production-impacting changes.
6. Run Spec Kit analyze/converge before declaring each slice complete.

## Verification
- Unit/integration tests for changed behavior.
- Build/typecheck.
- Security regression checks.
- Migration startup check when schema changes.
- Render deployment and runtime health verification for production changes.