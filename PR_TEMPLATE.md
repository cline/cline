<!--
Thank you for contributing to Cline!

⚠️ Important: Before submitting this PR, please ensure you have:
- For feature requests: Created a discussion in our Feature Requests discussions board https://github.com/cline/cline/discussions/categories/feature-requests and received approval from core maintainers before implementation
- For all changes: Link the associated issue/discussion in the "Related Issue" section below

Limited exceptions:
Small bug fixes, typo corrections, minor wording improvements, or simple type fixes that don't change functionality may be submitted directly without prior discussion.

Why this requirement?
We deeply appreciate all community contributions - they are essential to Cline's success! To ensure the best use of everyone's time and maintain project direction, we use our Feature Requests discussions board to gauge community interest and validate feature ideas before implementation begins. This helps us focus development efforts on features that will benefit the most users.
-->

### Related Issue

**Issue:** Fixes integration test failures caused by circular dependency in SharedUriHandler

### Description

Resolves `TypeError: Class extends value undefined` error in integration tests by fixing a circular dependency between `SharedUriHandler` and `WebviewProvider`.

- Convert WebviewProvider import to type-only import
- Update handleUri method to accept webviewProvider parameter  
- This resolves integration test failures caused by class extending undefined at runtime

### Test Procedure

- Ran `npm test` - all 62 unit tests and integration tests now pass (previously integration tests were failing)
- Verified the circular dependency is resolved by using type-only imports and dependency injection pattern
- Confirmed existing functionality remains intact - no changes to user-facing behavior
- Integration tests that were previously failing due to class extension errors now complete successfully

### Type of Change

-   [x] 🐛 Bug fix (non-breaking change which fixes an issue)

### Pre-flight Checklist

-   [x] Changes are limited to a single feature, bugfix or chore (split larger changes into separate PRs)
-   [x] Tests are passing (`npm test`) and code is formatted and linted (`npm run format && npm run lint`)
-   [ ] I have created a changeset using `npm run changeset` (required for user-facing changes)
-   [x] I have reviewed [contributor guidelines](https://github.com/cline/cline/blob/main/CONTRIBUTING.md)

### Additional Notes

This is a small bug fix that resolves test infrastructure issues without changing user-facing functionality.
