# Code Summary - future-runtime-expansion-framework

## Overview
Unit 5 now encodes the remaining future runtime roadmap directly in code after Kiro CLI was promoted to an active MVP runtime path.

## Application Code Changes
- Added `src/core/api/runtime/future-runtime-framework.ts`

## Tests Added
- Added `src/core/api/runtime/__tests__/future-runtime-framework.test.ts`

## Verification
- future runtime descriptor smoke: `unit5-future-runtime-ok`

## Scope Note
- the descriptor catalog now covers `github-cli` and `custom-langgraph-cli`
- `kiro-cli` moved out of this catalog because it is now an active runtime onboarding effort
