# Phase 2 · Shared types

Back to [overview.md](overview.md).

## Goal

Illegal bank shapes fail parse at `@cline/shared`.

## Changes

`sdk/packages/shared/src/drive/bank.ts`, `events.ts`, exports, tests.

## Data structures

Zod schemas for DriveTask, DrivePlan, bank lifecycle DriveEvents.

## Verification

`bun -F @cline/shared test` and `bun run build:sdk`.
