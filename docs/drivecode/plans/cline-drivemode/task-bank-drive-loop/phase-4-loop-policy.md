# Phase 4 · Loop policy

Back to [overview.md](overview.md).

## Goal

Auto Plan/Agent from bank; Ask/Debug overrides; refuse unbound Agent.

## Changes

`driveLoop.ts`, `driveMode.ts` in `@cline/drive`.

## Data structures

`DriveLoopState { posture, override?, boundTaskId? }`.

## Verification

Policy matrix unit tests.
