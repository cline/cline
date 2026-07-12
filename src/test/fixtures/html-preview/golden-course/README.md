# HTML Preview Runtime Contract Fixture

This directory contains a hand-authored, deterministic fixture for testing the **current** AI-Hydro HTML Preview and course contracts.

It is intentionally neutral and does not introduce a product rebrand or a new runtime.

## Contents

- `course.json` — two-module course with one prerequisite edge.
- `01-runtime-contract/module.html` — manifest, executable cells, persistent control binding, structured outputs, deliberate error, and canonical self-check quiz.
- `02-prerequisite-target/module.html` — target module used to verify prerequisite unlocking and navigation.

## Purpose

The fixture should become the compatibility target for:

- current module validation;
- cell discovery and stable IDs;
- persistent Python namespace;
- error recovery;
- image output;
- module control-state persistence;
- quiz completion and course progress;
- prerequisite navigation;
- standalone browser degradation.

Future generators may target this contract only after the corresponding runtime behavior is covered by tests.

## Validation stages

1. Static validator and contract assertions.
2. VS Code runtime execution and persistence checks.
3. Quarto-generated output equivalence after the runtime contract is fully audited.

## Scope

This fixture does not claim secure assessment: the current canonical self-check quiz stores its answer index in HTML markup. It is suitable for deterministic learning checkpoints and runtime tests.
