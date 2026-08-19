---
name: api-design
description: Design clean APIs — REST, RPC, or library interfaces with consistent naming, error handling, and versioning.
---

# API Design Skill

When designing or reviewing an API (REST, RPC, or library), follow these principles:

## 1. Understand the Consumer

- Who calls this API? (Frontend, other services, CLI, third-party developers)
- What are the most common operations?
- What error conditions do consumers need to handle?
- What's the expected request volume and latency budget?

## 2. Naming Conventions

- Use consistent, predictable names across all endpoints/methods.
- Nouns for resources, verbs for actions: `GET /users`, `POST /users/:id/activate`.
- For library APIs: verb-first for actions (`createUser`, `deleteSession`), noun-first for accessors (`getUserById`).
- Avoid abbreviations unless universally understood (`id`, `url`, `api`).
- Be specific: `getActiveUserCount()` not `getCount()`.

## 3. Input Design

- Accept the minimum required input. Optional fields should have sensible defaults.
- Use typed schemas (Zod, JSON Schema) for validation at the boundary.
- Reject invalid input early with clear error messages.
- For REST: use path params for identity (`/users/:id`), query params for filtering (`?status=active`), body for creation/mutation.
- For libraries: prefer options objects over long parameter lists.

## 4. Output Design

- Return consistent shapes. Every endpoint should return the same envelope structure.
- Include enough context for the consumer to act without a follow-up call.
- Paginate list endpoints. Always include `total`, `limit`, `offset` or cursor.
- Use ISO 8601 for dates, consistent casing (camelCase or snake_case, not both).

## 5. Error Handling

- Use standard HTTP status codes (REST) or typed error codes (RPC/library).
- Every error response must include: error code, human-readable message, and request ID.
- Distinguish client errors (4xx / validation) from server errors (5xx / internal).
- Never expose internal details (stack traces, SQL, file paths) in production errors.
- Document every error code the consumer might receive.

## 6. Versioning & Evolution

- Version the API from day one (`/v1/`, header-based, or semver for libraries).
- Additive changes (new fields, new endpoints) are non-breaking.
- Removing or renaming fields is breaking — deprecate first, remove in next major version.
- Document breaking changes in a changelog.

## 7. Documentation

For each endpoint or method, document:
1. Purpose (one sentence).
2. Input parameters with types and constraints.
3. Output shape with example.
4. Error codes and when they occur.
5. Authentication/authorization requirements.
6. Rate limits if applicable.
