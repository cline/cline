# Feedback Examples

## Good vs Bad Feedback

### Be Specific, Not Vague

```markdown
BAD: "This is confusing"

GOOD: "This function handles both validation and persistence. Consider
      splitting into `validateUser()` and `saveUser()` for single
      responsibility and easier testing."
```

### Be Actionable, Not Just Critical

```markdown
BAD: "Fix the query"

GOOD: "This will cause N+1 queries - one per post. Use `include: [Author]`
      to eager load authors in a single query. See: [link to docs]"
```

### Be Constructive, Not Demanding

```markdown
BAD: "Add tests"

GOOD: "Missing test for the case when `email` is already taken. Add a test
      that verifies 409 is returned with appropriate error message."
```

### Ask Questions, Don't Assume

```markdown
BAD: "This is wrong"

GOOD: "I notice this returns null instead of throwing. Is that intentional?
      The other methods throw on not-found. Should this be consistent?"
```

## Praise Examples

Reinforce good patterns with specific praise:

```markdown
"Great use of early returns here - much more readable than nested ifs!"

"Nice extraction of this validation logic into a reusable function."

"Excellent error messages - they'll help debugging in production."

"Good choice using a discriminated union here instead of optional fields."

"Appreciate the comprehensive test coverage, especially the edge cases."
```

## Feedback by Category

### Critical (Must Fix)

```markdown
**[CRITICAL] Security: SQL Injection**
Location: `src/users/service.ts:45`

The query uses string interpolation:
`SELECT * FROM users WHERE id = ${id}`

This is vulnerable to SQL injection. Use parameterized query:
`db.query('SELECT * FROM users WHERE id = $1', [id])`
```

### Major (Should Fix)

```markdown
**[MAJOR] Performance: N+1 Query**
Location: `src/posts/service.ts:23`

Current code fetches users in a loop (N+1 problem):
```typescript
for (const post of posts) {
  post.author = await User.findById(post.authorId);
}
```

Suggestion: Use eager loading:
```typescript
const posts = await Post.findAll({ include: [User] });
```

Impact: ~100 extra DB queries per request with current approach.
```

### Minor (Nice to Have)

```markdown
**[MINOR] Naming: Unclear variable**
Location: `src/utils/date.ts:12`

`d` is unclear. Consider `createdDate` or `timestamp` for better readability.

**[MINOR] Style: Prefer const**
Location: `src/config/index.ts:8`

`let config` is never reassigned. Use `const` for immutability.
```

## Question Format

```markdown
**[QUESTION]**
Location: `src/orders/service.ts:67`

What's the expected behavior when the user has an existing pending order?
Should this:
- Return the existing order?
- Create a new one anyway?
- Return an error?
```

## Summary Format

```markdown
## Summary

Overall this is a solid implementation of the user registration flow.
The validation logic is clean and the error handling is comprehensive.

**Blocking Issues**: 1 critical (SQL injection)
**Suggestions**: 2 major, 3 minor

Once the SQL injection is fixed, this is ready to merge. The major
suggestions are performance improvements worth considering.
```

## Quick Reference

| Feedback Type | Tone | Required Action |
|---------------|------|-----------------|
| Critical | Firm, clear | Must fix before merge |
| Major | Suggestive | Should fix |
| Minor | Optional | Nice to have |
| Praise | Positive | None - reinforcement |
| Question | Curious | Response needed |
