# Code Summary - kiro-cli-runtime-onboarding

## Overview
Kiro CLI was promoted from a future-runtime descriptor to an active MVP runtime provider using the runtime handler factory seam.

## Application Code Changes
- Added `src/core/api/providers/kiro-cli.ts`
- Added `src/core/api/runtime/factories/kiro-cli.ts`
- Added `src/integrations/kiro-cli/acceptance-harness.ts`
- Added `src/integrations/kiro-cli/session-isolation-smoke.ts`
- Added `src/integrations/kiro-cli/run-acceptance.ts`
- Added `src/integrations/kiro-cli/run-isolation-smoke.ts`
- Added `src/integrations/kiro-cli/prompt.ts`
- Added `src/integrations/kiro-cli/run.ts`
- Added harness tests for acceptance and isolation smoke
- Updated shared provider/runtime metadata and CLI provider-selection surfaces to recognize `kiro-cli`
- Updated `runKiroCli()` to accept injected `cwd`, env, and timeout for runtime harness execution

## Verification
- `kiro-prompt-ok`
- `kiro-factory-ok`
- `kiro-runtime-modules-ok`
- `kiro-proto-ok`
- `kiro-acceptance-harness-ok`
- `kiro-isolation-harness-ok`
- live `npm run test:kiro:acceptance` passed on the current Linux aarch64 server
- live `npm run test:kiro:isolation:linux` passed on the current Linux aarch64 server

## Current Limits
- This MVP uses the officially documented `kiro-cli chat --no-interactive` text path
- It does not yet support structured tool-call streaming comparable to Claude Code
