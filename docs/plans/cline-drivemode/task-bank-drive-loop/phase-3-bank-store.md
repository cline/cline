# Phase 3 · Bank store

Back to [overview.md](overview.md).

## Goal

Single-writer bank over injected `BankFs`.

## Changes

`@cline/drive` paths, snapshot, store, archive moves.

## Data structures

`BankSnapshot`, `BankFs`, store API.

## Verification

`bun -F @cline/drive test` for create/complete/archive/edit.
