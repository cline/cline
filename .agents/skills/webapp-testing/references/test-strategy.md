# Test Strategy Reference

## Two-Level Testing Architecture

### Level 1: Unit Tests (Vitest)
- **Framework**: Vitest + @testing-library/react
- **Environment**: jsdom
- **Scope**: Components, hooks, utilities, business logic
- **Config**: `nextjs/vitest.config.ts`
- **Setup**: `nextjs/vitest.setup.ts` (mocks for router, i18n, auth, theme)
- **Coverage target**: 80%+

### Level 2: Integration Tests (Playwright)
- **Framework**: Playwright
- **Scope**: Screen states, navigation, user flows, cross-screen journeys
- **Config**: `nextjs/playwright.config.ts`
- **Base URL**: http://localhost:3000

## Persistence Boundary Overlay

When screens are designed to outlive a mock dataset or storage adapter, the strategy adds a boundary-preservation overlay:

- verify the same selectors and user-visible state names remain valid across adapter modes
- verify fixture coverage for declared screen states before trusting green results
- treat missing live adapters as a readiness gap, not a reason to couple tests to storage details
- prefer contract assertions at the UI/API seam over repository-specific assertions

## Test Generation Pipeline

```
screen-inventory.md ─────→ ScreenStateTestGenerator ──→ __tests__/screens/*.test.tsx
                                                      → tests/screens/*.spec.ts

interaction-flows/*.md ──→ FlowTestGenerator ─────────→ __tests__/flows/*.test.tsx
                                                      → tests/flows/*.spec.ts

screen-story-matrix.md ──→ CoverageGapTestGenerator ─→ __tests__/coverage-gaps/gap-tests.test.tsx

boundary-mode matrix ────→ Readiness/Parity Review ──→ readiness.md, validation-summary.md
```

## Screen ID to Route Mapping

| Screen ID | Route | Layout |
|-----------|-------|--------|
| SCR-AUTH-01 | /login | AuthLayout |
| SCR-AUTH-02 | /pending | AuthLayout |
| SCR-AUTH-03 | /access | AuthLayout |
| SCR-APP-01 | /studio | AppShell |
| SCR-APP-02 | /playground | AppShell |
| SCR-APP-03 | /marketplace | AppShell |
| SCR-APP-04 | /search | AppShell |
| SCR-ADM-01 | /admin | AppShell (Admin) |
| SCR-ADM-02 | /admin/users | AppShell (Admin) |
| SCR-ADM-03 | /admin/usage | AppShell (Admin) |
| SCR-ADM-04 | /admin/health | AppShell (Admin) |
