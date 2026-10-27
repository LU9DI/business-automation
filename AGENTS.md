# Agent guidance — business-automation

Independent Node.js/TypeScript/Express and PostgreSQL service for workflow automation and integrations.

## Skill routing
- HTTP routes and response contracts: read .agents/skills/api-design-principles/SKILL.md.
- JWT, roles, tenant boundaries, or credentials: read .agents/skills/auth-implementation-patterns/SKILL.md.
- Workflow execution, retries, connector calls, messaging, or irreversible side effects: read .agents/skills/workflow-automation-safety/SKILL.md.

## Validation
Run npm ci, npm run check, and npm test for relevant changes. Use mocks in tests and never trigger real customer-facing side effects.
