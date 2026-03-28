# NFR Requirements

- Claude Code migration must be regression-safe for existing provider-driven call sites.
- Runtime factory registration must be additive and must not expand `switch` complexity for each migrated runtime.
- Claude Code remains the compatibility benchmark for external CLI runtime behavior.
- Credential and process-boundary rules from Units 2 and 3 remain authoritative.
