# Business Rules

- Shim wrapper must not contain runtime-specific JSON parsing logic.
- Stream translators must not own process lifecycle or credential lookup.
- Non-zero exit and spawn failures must normalize into a shared shim error contract.
- Stderr is diagnostic-only input and must not corrupt stdout translation flow.
- Partial stdout payloads may be buffered only inside the translator boundary.
- Claude Code remains the reference stream format but the wrapper contract must be reusable for later Kiro and LangGraph runtimes.
