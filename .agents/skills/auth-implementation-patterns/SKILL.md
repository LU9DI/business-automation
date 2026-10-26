---
name: auth-implementation-patterns
description: Review JWT auth, role checks, tenant isolation, and secret handling.
---
# Authentication and authorization
- Verify JWT signature and expiry; validate configured issuer/audience if present.
- Enforce object-level ownership and tenant boundaries for every read, write, workflow, and integration credential.
- Never trust a user or tenant identifier supplied only in request data.
- Keep secrets in environment/secret storage; redact tokens and credentials from logs.
- Fail closed on invalid auth configuration; do not weaken CORS or authorization for convenience.
- Test missing, malformed, expired, insufficient-role, cross-tenant, and revoked credentials.
