# Code Summary - shim-wrapper-and-stream-translation-reference

## Overview
Unit 3 introduces a reusable external-runtime shell and a translation boundary, then migrates Claude Code execution onto that boundary as the reference implementation.

## Application Code Changes
- Added `src/core/api/runtime/shim-types.ts`
  - normalized shim execution and failure entities
- Added `src/core/api/runtime/stream-translator.ts`
  - reusable stdout translation contract
- Added `src/core/api/runtime/shim-wrapper.ts`
  - generic process launcher with line-based stdout iteration and normalized failures
- Added `src/integrations/claude-code/stream-translator.ts`
  - Claude Code reference translator for stream-json payloads
- Updated `src/integrations/claude-code/run.ts`
  - moved execa/readline orchestration behind the generic shim wrapper and translator seam

## Tests Added
- Added `src/core/api/runtime/__tests__/shim-wrapper.test.ts`
- Added `src/integrations/claude-code/stream-translator.test.ts`

## Verification
- module load smoke:
  - `unit3-runtime-shim-modules-ok`
- shim runtime smoke using `node -e` subprocess:
  - `unit3-shim-runtime-ok`
- Claude translator smoke:
  - `unit3-claude-translator-ok`
- Claude run orchestrator load smoke:
  - `unit3-claude-run-ok`

## Verification Limits
- direct Mocha execution remains limited by the workspace's Node 25 plus Mocha ESM/path-alias behavior
- Unit 3 stops at reusable execution and translation boundaries; Claude provider migration and later runtime onboarding remain later-unit work
