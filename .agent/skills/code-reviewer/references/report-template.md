# Report Template

## Full Review Report Template

```markdown
# Code Review: [PR Title]

## Summary
[1-2 sentence overview of the changes and overall assessment]

**Verdict**: [ ] Approve | [x] Request Changes | [ ] Comment

## Critical Issues (Must Fix)

### 1. [File:Line] Security: SQL Injection Risk
- **Current**: String interpolation in query
- **Suggested**: Use parameterized query
- **Impact**: Potential data breach

```typescript
// Current (vulnerable)
const query = `SELECT * FROM users WHERE id = ${id}`;

// Suggested (secure)
const query = 'SELECT * FROM users WHERE id = $1';
db.query(query, [id]);
```

## Major Issues (Should Fix)

### 1. [File:Line] Performance: N+1 Query
- **Current**: Fetching users in loop
- **Suggested**: Use eager loading with include
- **Impact**: ~100 extra DB queries per request

### 2. [File:Line] Logic: Missing edge case
- **Current**: No handling for empty array
- **Suggested**: Add guard clause
- **Impact**: Potential runtime error

## Minor Issues (Nice to Have)

### 1. [File:Line] Naming: Unclear variable name
- **Current**: `d`
- **Suggested**: `createdDate`

### 2. [File:Line] Style: Inconsistent formatting
- **Current**: Mixed quotes
- **Suggested**: Use single quotes consistently

## Positive Feedback
- Clean separation of concerns in service layer
- Comprehensive input validation on DTOs
- Good test coverage for edge cases
- Excellent error messages

## Questions for Author
- What's the expected behavior when X happens?
- Should this support pagination for large datasets?
- Is the retry logic intentional or accidental?

## Test Coverage Assessment
- [ ] Happy path tested
- [x] Error cases tested
- [ ] Edge cases tested (missing empty array test)
- [x] Integration tests present

## Checklist
- [x] No security vulnerabilities
- [ ] Performance is acceptable (N+1 issue)
- [x] Code is readable
- [x] Tests are adequate
- [x] Documentation is present
```

## Verdict Guidelines

| Verdict | When to Use |
|---------|-------------|
| **Approve** | No blocking issues, minor suggestions only |
| **Request Changes** | Critical or major issues must be fixed |
| **Comment** | Questions need answers, no blocking issues |

## Severity Definitions

| Severity | Definition | Examples |
|----------|------------|----------|
| **Critical** | Security risk, data loss, crashes | SQL injection, auth bypass |
| **Major** | Significant performance, maintainability | N+1 queries, god functions |
| **Minor** | Style, naming, small improvements | Variable names, formatting |

## Time Boxing

| Section | Suggested Time |
|---------|----------------|
| Context & understanding | 5 minutes |
| Critical/security review | 10 minutes |
| Logic & performance | 15 minutes |
| Tests review | 10 minutes |
| Writing report | 10 minutes |
| **Total** | ~50 minutes |

## Quick Checks Before Submitting

- [ ] All critical issues have clear remediation
- [ ] Major issues explain the impact
- [ ] At least one positive comment included
- [ ] Questions are specific and answerable
- [ ] Verdict matches the issues found
