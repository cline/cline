# Business Rules

## Rule Set 1: Ownership Separation
1. Runtime execution logic must not read raw storage keys directly.
2. Runtime-specific config must be materialized by the persistence boundary, not by runtime adapters.
3. Credential resolution policy must be centralized in the persistence boundary.
4. Capability cache state must be partitioned by runtime identity.
5. Execution metadata must be stored separately from credentials and configuration inputs.

## Rule Set 2: Scope Precedence
1. Existing brownfield precedence between global state, task settings, session overrides, and remote config must remain intact.
2. Runtime-aware reads may reshape outputs, but must not silently reorder precedence.
3. Session-scoped overrides must not leak into persistent runtime defaults unless explicitly committed by a config write flow.
4. Workspace-scoped state must not overwrite runtime-global settings unless the current UX already allows it.

## Rule Set 3: Credential Mediation
1. Future runtime IDs do not imply future secret storage layouts automatically.
2. A runtime may map to one or more legacy secret keys, but the mapping must be explicit.
3. Absence of a required credential must resolve as a typed missing-credential condition, not a silent fallback.
4. Credential access must be least-privilege:
   - callers receive only the credentials required for that runtime path
   - callers do not receive unrestricted secret store access

## Rule Set 4: Capability Cache Integrity
1. Probe results must carry runtime identity and freshness context.
2. Cached capability data for `claude-code` must never be reused for `kiro-cli`, `gh`, or `custom-langgraph-cli`.
3. Failed probes may be cached only with explicit failure-state semantics.
4. Capability cache invalidation must be triggered by relevant config changes, runtime path changes, or explicit probe refresh events.

## Rule Set 5: Execution Metadata Integrity
1. Execution records must be safe to write even if the runtime invocation later fails.
2. Metadata writes must not mutate runtime configuration state as a side effect.
3. Metadata writes must avoid secret-bearing payloads.
4. Probe records and execution records must be distinguishable.

## Rule Set 6: Migration and Backward Compatibility
1. Existing provider-centric UI flows must continue to work while the runtime architecture is being introduced incrementally.
2. Provider-config writes from CLI or UI must pass through a migration seam that can later target runtime-native fields.
3. Proto conversion must remain backward-compatible for current providers during the migration window.
4. Unit 2 must prepare migration seams without forcing runtime-specific onboarding before Unit 4 and Unit 5.

## Rule Set 7: Failure Handling
1. Missing runtime mappings must fail closed.
2. Unsupported runtime-specific config combinations must surface explicit validation failures.
3. Stale capability cache data must not be treated as current readiness without freshness validation.
4. Boundary-level errors must be normalized so later orchestration services can distinguish:
   - config missing
   - credential missing
   - capability cache stale
   - metadata record failure

## Rule Set 8: Security Constraints
1. Credentials must never be logged as part of runtime boundary operations.
2. Default or fallback mappings must not point a future runtime to an unrelated secret key by accident.
3. Security-critical mapping logic must stay inside dedicated boundary components rather than being copied into runtime adapters.
4. Supply-chain trust for external runtime binaries is not decided in Unit 2, but the persistence boundary must support recording trusted-path metadata later.
