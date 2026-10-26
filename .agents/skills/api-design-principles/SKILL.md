---
name: api-design-principles
description: Design stable HTTP contracts for business-automation services.
---
# API design principles
- Follow existing Express route, validation, response, and error conventions.
- Validate untrusted input at the boundary; bound payloads, pagination, execution duration, and expensive operations.
- Keep authentication, authorization, validation, business logic, and persistence separate.
- Return structured errors without stack traces, SQL details, tokens, or personal data.
- Make mutating operations idempotent when retries are possible and use transactions for multi-step state changes.
- Test unauthenticated, forbidden, malformed, duplicate, timeout, and success paths.
