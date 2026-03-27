# Spec Compliance Review

---

## Two-Stage Review Architecture

```
                    ┌─────────────────────┐
                    │   Implementation    │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  STAGE 1: Spec      │
                    │  Compliance Review  │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                  │
      ┌───────▼───────┐                ┌────────▼────────┐
      │   ✗ Issues    │                │   ✓ Compliant   │
      │     Found     │                │                 │
      └───────┬───────┘                └────────┬────────┘
              │                                  │
              │                        ┌────────▼────────┐
              │                        │  STAGE 2: Code  │
              │                        │  Quality Review │
              │                        └────────┬────────┘
              │                                  │
              │                    ┌─────────────┴─────────────┐
              │                    │                           │
              │            ┌───────▼───────┐         ┌────────▼────────┐
              │            │   ✗ Issues    │         │   ✓ Approved    │
              │            │     Found     │         │                 │
              │            └───────┬───────┘         └─────────────────┘
              │                    │
              └────────────────────┴────────────────────┐
                                                        │
                                              ┌─────────▼─────────┐
                                              │ Return to Author  │
                                              └───────────────────┘
```

**Critical:** Complete Stage 1 (spec compliance) BEFORE Stage 2 (code quality). Never review code quality for functionality that doesn't meet the specification.

---

## Stage 1: Spec Compliance Review

### Core Directive

> "The implementer finished suspiciously quickly. Their report may be incomplete, inaccurate, or optimistic."

Approach every review with professional skepticism. Verify claims independently.

### The Three Verification Categories

#### Category 1: Missing Requirements

**Check for features that were requested but not implemented.**

| Question | How to Verify |
|----------|---------------|
| Did they skip requested features? | Compare PR to original requirements line by line |
| Are edge cases handled? | Check error paths, empty states, boundaries |
| Were error scenarios addressed? | Look for try/catch, error boundaries, validation |
| Is the happy path complete? | Trace through primary use case manually |

```markdown
## Example Review Finding

**Missing Requirement:** Issue #42 requested "password must be at least 8 characters"

**Found in code:**
```typescript
// No length validation present
function validatePassword(password: string) {
  return password.length > 0;  // Only checks non-empty
}
```

**Status:** ❌ Incomplete - minimum length validation missing
```

#### Category 2: Unnecessary Additions

**Check for scope creep and over-engineering.**

| Question | How to Verify |
|----------|---------------|
| Features beyond specification? | Compare to original requirements |
| Over-engineering? | Is complexity justified by requirements? |
| Premature optimization? | Is performance cited without measurements? |
| Unrequested abstractions? | Are there helpers/utils for one-time use? |

```markdown
## Example Review Finding

**Unnecessary Addition:** Added caching layer not in requirements

**Found in code:**
```typescript
// Original requirement: "Fetch user by ID"
// Actual implementation:
class CachedUserRepository {  // Not requested
  private cache = new Map();
  private ttl = 60000;

  async getUser(id: string) {
    if (this.cache.has(id)) { ... }
    // 50 lines of cache logic
  }
}
```

**Status:** ⚠️ Scope creep - discuss before merging
```

#### Category 3: Interpretation Gaps

**Check for misunderstandings of requirements.**

| Question | How to Verify |
|----------|---------------|
| Different understanding of requirements? | Ask author to explain their interpretation |
| Unclarified assumptions? | Look for comments like "assuming..." |
| Ambiguous specs resolved incorrectly? | Compare to similar existing features |

```markdown
## Example Review Finding

**Interpretation Gap:** "Sort by date" implemented as ascending

**Requirement stated:** "Sort by date" (ambiguous)

**Author implemented:** Oldest first (ascending)

**Expected:** Most recent first is typical UX pattern

**Status:** ❓ Clarify - which sort order was intended?
```

---

## Why Order Matters

### Stage 1 Must Come First

| Scenario | Waste from Wrong Order |
|----------|------------------------|
| Skip Stage 1 | Review 500 lines of code quality, then discover wrong feature was built |
| Stage 2 First | Suggest refactoring, then realize the code shouldn't exist |
| Combined | Mix concerns, miss systematic issues |

### Separation of Concerns

- **Stage 1 (Spec):** Does it do the right thing?
- **Stage 2 (Quality):** Does it do the thing right?

Code quality review is meaningless if the code doesn't implement the correct functionality.

---

## Spec Compliance Checklist

### Before You Start

- [ ] Read the original issue/ticket completely
- [ ] Identify all explicit requirements
- [ ] Identify implicit requirements from context
- [ ] Note any acceptance criteria listed

### During Review

**Missing Requirements:**
- [ ] All required features present
- [ ] Edge cases covered (empty, null, max values)
- [ ] Error handling as specified
- [ ] Happy path fully functional
- [ ] UI matches mockups/specs if provided

**Unnecessary Additions:**
- [ ] No unrequested features
- [ ] No speculative abstractions
- [ ] No premature optimizations
- [ ] Scope matches requirements exactly

**Interpretation Gaps:**
- [ ] Author's understanding matches spec
- [ ] Ambiguities resolved correctly
- [ ] Assumptions are documented and valid
- [ ] Behavior matches similar existing features

### After Review

- [ ] Document all findings with file:line references
- [ ] Categorize as missing/unnecessary/interpretation
- [ ] Prioritize: blocking vs. non-blocking issues

---

## Output Format

### Compliant Result

```markdown
## Spec Compliance Review: ✅ PASS

All requirements verified:
- ✅ User can upload profile image (req #1)
- ✅ Image resized to 200x200 (req #2)
- ✅ Invalid formats rejected with error message (req #3)
- ✅ Progress indicator during upload (req #4)

**Proceed to:** Code Quality Review
```

### Issues Found

```markdown
## Spec Compliance Review: ❌ ISSUES FOUND

### Missing Requirements

1. **Progress indicator not implemented** (req #4)
   - File: `ProfileUpload.tsx`
   - Expected: Progress bar during upload
   - Found: No progress indication

2. **Error messages not user-friendly** (req #3)
   - File: `ProfileUpload.tsx:45`
   - Expected: "Please upload a JPG or PNG file"
   - Found: "Error: INVALID_FORMAT"

### Unnecessary Additions

1. **Image cropping feature not requested**
   - File: `ImageCropper.tsx` (new file, 150 lines)
   - Impact: Adds complexity, delays delivery
   - Recommendation: Remove or create separate PR

**Action Required:** Address missing requirements before code quality review
```

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong |
|---------|----------------|
| Reviewing code style before spec compliance | Wasted effort if wrong thing was built |
| Assuming spec was followed | Verify independently |
| Skipping edge cases | Bugs hide in boundaries |
| Accepting "we can add it later" | Technical debt accumulates |
| Missing scope creep | Unreviewed code enters codebase |

---

*Content adapted from [obra/superpowers](https://github.com/obra/superpowers) by Jesse Vincent (@obra), MIT License.*
