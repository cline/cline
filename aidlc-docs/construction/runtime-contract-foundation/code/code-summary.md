# Code Summary - runtime-contract-foundation

## Overview
Unit 1 introduced the first runtime foundation layer that sits in front of the existing provider-centric handler creation flow.

## Application Code Changes
- Added `src/core/api/runtime/contracts.ts`
  - canonical runtime definition and capability contract
- Added `src/core/api/runtime/registry.ts`
  - additive runtime registration and fail-closed validation
- Added `src/core/api/runtime/legacy-provider-mapping.ts`
  - brownfield provider-to-runtime and runtime-to-provider mediation
- Updated `src/core/api/index.ts`
  - added default runtime registry
  - routed `buildApiHandler()` through runtime resolution before handler construction
- Updated `src/shared/api.ts`
  - added `RuntimeId`, future runtime placeholders, and runtime mapping helpers
- Updated `src/shared/storage/provider-keys.ts`
  - made provider-model-key lookup runtime-aware
- Updated `src/shared/proto-conversions/models/api-configuration-conversion.ts`
  - added runtime-aware proto conversion helpers

## Tests Added
- Added `src/core/api/runtime/__tests__/registry.test.ts`
- Added `src/core/api/runtime/__tests__/legacy-provider-mapping.test.ts`
- Updated `src/core/api/providers/__tests__/claude-code.test.ts`
  - added a regression check that the Claude Code handler is still selected through the registry seam

## Verification
- Installed dependencies with `npm ci --ignore-scripts`
- Restored `grpc-tools` binary with `npm rebuild grpc-tools --foreground-scripts`
- Regenerated proto artifacts with `npm run protos`
- Verified runtime foundation modules load:
  - `TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -e "require('./src/core/api/runtime/registry.ts'); require('./src/core/api/runtime/legacy-provider-mapping.ts'); console.log('runtime-modules-ok')"`
- Verified Claude Code still routes through the registry seam:
  - `TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "... buildApiHandler(...) ..."`
  - result: `claude-code-registry-ok`

## Verification Limits
- Direct targeted Mocha execution for the new tests is currently blocked by the workspace's Node 25 plus Mocha ESM path-alias resolution behavior.
- Full `tsc -p tsconfig.unit-test.json --noEmit` still surfaces broader repository-level issues outside Unit 1, so it is not a clean unit-local signal in this worktree.
