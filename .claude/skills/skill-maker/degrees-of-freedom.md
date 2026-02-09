# Degrees of Freedom

Choose the right level of constraint based on the task requirements.

## High Freedom (Text Instructions)

Use when:
- Multiple valid approaches exist
- Context-dependent decisions needed
- Creativity or judgement required

```markdown
## Code Review Guidelines

Review for:
- Logic errors and edge cases
- Security vulnerabilities
- Performance concerns
- Code style consistency
```

## Medium Freedom (Pseudocode with Parameters)

Use when:
- Preferred patterns exist but variation is acceptable
- Some steps are fixed, others flexible

```markdown
## API Endpoint Creation

1. Define route at `/api/v1/{resource}`
2. Implement request validation using Pydantic
3. Add error handling (return appropriate HTTP codes)
4. Write tests covering happy path and error cases
```

## Low Freedom (Specific Scripts)

Use when:
- Fragile operations requiring exact sequences
- Same code repeatedly rewritten
- Deterministic reliability needed
- External tools with specific syntax

```markdown
## Database Migration

Run the migration script:
```bash
python scripts/migrate.py --env $ENVIRONMENT
```

This handles connection, validation, and rollback automatically.
```

## Decision Matrix

| Scenario | Freedom Level | Implementation |
|----------|---------------|----------------|
| Code style guidelines | High | Text instructions |
| API design patterns | Medium | Pseudocode |
| Database migrations | Low | Script |
| Code review | High | Text instructions |
| Build/deploy process | Low | Script |
| Documentation format | Medium | Template + instructions |

## Rule of Thumb

- If you find yourself rewriting the same code, make it a script
- If the operation has one right way, make it a script
- If judgement is needed, use instructions
- If there's a preferred pattern with acceptable variation, use pseudocode
