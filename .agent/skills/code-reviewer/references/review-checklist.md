# Review Checklist

## Comprehensive Review Checklist

| Category | Key Questions |
|----------|---------------|
| **Design** | Does it fit existing patterns? Right abstraction level? |
| **Logic** | Edge cases handled? Race conditions? Null checks? |
| **Security** | Input validated? Auth checked? Secrets safe? |
| **Performance** | N+1 queries? Memory leaks? Caching needed? |
| **Tests** | Adequate coverage? Edge cases tested? Mocks appropriate? |
| **Naming** | Clear, consistent, intention-revealing? |
| **Error Handling** | Errors caught? Meaningful messages? Logged? |
| **Documentation** | Public APIs documented? Complex logic explained? |

## Review Process

### 1. Context (5 min)
- [ ] Read PR description
- [ ] Understand the problem being solved
- [ ] Check linked issues/tickets
- [ ] Note expected changes

### 2. Structure (10 min)
- [ ] Review file organization
- [ ] Check architectural fit
- [ ] Verify design patterns used
- [ ] Note any breaking changes

### 3. Code Details (20 min)
- [ ] Review logic correctness
- [ ] Check edge cases
- [ ] Verify error handling
- [ ] Look for security issues
- [ ] Check performance concerns
- [ ] Review naming clarity

### 4. Tests (10 min)
- [ ] Verify test coverage
- [ ] Check test quality
- [ ] Look for edge case tests
- [ ] Ensure mocks are appropriate

### 5. Final Pass (5 min)
- [ ] Note positive patterns
- [ ] Prioritize feedback
- [ ] Write summary

## Category Deep Dive

### Design Questions
- Does this change belong in this file/module?
- Is the abstraction level appropriate?
- Could this be simpler?
- Does it follow existing patterns?
- Is it extensible without modification?

### Logic Questions
- What happens with null/undefined inputs?
- Are boundary conditions handled?
- Could there be race conditions?
- Is the order of operations correct?
- Are all code paths tested?

### Security Questions
- Is all user input validated?
- Are SQL queries parameterized?
- Is output properly encoded?
- Are secrets handled safely?
- Is authentication checked?
- Is authorization enforced?

### Performance Questions
- Are there N+1 query patterns?
- Is data fetched efficiently?
- Are expensive operations cached?
- Could this cause memory leaks?
- Is pagination implemented?

## Quick Reference

| Review Focus | Time % |
|--------------|--------|
| Context & PR description | 10% |
| Architecture & design | 20% |
| Code logic & details | 40% |
| Tests & coverage | 20% |
| Final review & summary | 10% |
