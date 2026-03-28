# NFR Requirements - persistence-boundary-and-config-mediation

## Scope
This document defines the non-functional requirements for Unit 2, which establishes the persistence boundary and configuration mediation rules for runtime-aware architecture.

## Scalability Requirements
- The persistence boundary must support additional runtimes without requiring raw storage access logic to be duplicated per runtime.
- Runtime-aware config mediation must scale by additive mapping definitions rather than ad hoc conditionals spread across CLI, controller, and proto layers.
- Capability cache partitioning must support multiple runtimes and sessions without cross-runtime contamination.

## Performance Requirements
- Runtime config resolution must remain low-latency relative to runtime execution cost.
- Credential resolution must avoid unnecessary broad secret-store reads.
- Capability-probe cache reads should be cheaper than re-probing the runtime whenever freshness allows.
- Metadata recording must be lightweight enough to occur on execution start and completion without noticeable UX regression.

## Availability Requirements
- Failure to resolve one runtime's config or credentials must not corrupt other runtime configurations.
- Stale or invalid capability cache entries must degrade to explicit refresh-needed state rather than false-ready state.
- Boundary failures must preserve the recoverability of the control plane by surfacing normalized error states.

## Security Requirements
- Credential lookup must be least-privilege and runtime-scoped.
- The persistence boundary must not expose raw storage internals or unrestricted secret-store access to runtime execution layers.
- Runtime-to-legacy secret mappings must be explicit, validated, and fail closed.
- Logs at this boundary must exclude credentials, secret-bearing config, and unsafe execution metadata.
- Misconfiguration prevention must cover runtime paths, credential references, and compatibility writes.

## Reliability Requirements
- Config precedence between global state, task settings, session overrides, and remote config must be deterministic and preserved.
- Cache invalidation triggers must be defined for config changes, runtime identity changes, and explicit probe refreshes.
- Metadata recording must remain logically separate from config writes so failures in one do not silently mutate the other.
- Boundary errors must be classifiable by failure type for later orchestration and UX handling.

## Maintainability Requirements
- Runtime-aware persistence logic must remain centralized rather than reintroduced into adapters, UI handlers, or proto conversion code.
- New runtime onboarding should primarily extend migration bindings and boundary policies rather than add new storage access patterns.
- The boundary design must remain compatible with incremental migration from provider-centric fields to runtime-aware fields.

## Testability Requirements
- The unit must support persistence ownership tests that validate who may read or write runtime-related state.
- It must support mapping tests for runtime-to-legacy config and secret bindings.
- It must support cache correctness tests covering freshness, invalidation, and cross-runtime isolation.
- It must support metadata-write tests that confirm separation from config and credential state.

## Observability Requirements
- Runtime boundary operations must expose structured events for config resolution, credential resolution, cache hits/misses, and metadata writes.
- Observability must correlate runtime ID, scope, resolution source, and failure reason.
- Security-sensitive operations must be observable without leaking secrets.

## Usability Requirements
- Existing provider-centric UI configuration flows must continue to function during migration.
- Runtime-aware config behavior must be explainable to later units through explicit scope and binding rules.
- Missing-credential and invalid-config states should be representable as precise user-facing conditions rather than generic failures.

## Compliance Summary
- `SECURITY-03`: Applicable and satisfied by structured logging without secret exposure
- `SECURITY-05`: Applicable and satisfied by explicit validation of mappings, paths, scopes, and writes
- `SECURITY-08`: Applicable and satisfied by runtime-scoped access control expectations around config and credentials
- `SECURITY-09`: Applicable and satisfied by fail-closed mapping and misconfiguration-prevention requirements
- `SECURITY-10`: Applicable as a downstream constraint because later runtime binaries and trust metadata depend on this boundary
- `SECURITY-11`: Applicable and satisfied by isolating security-critical mapping logic inside the persistence boundary
- `SECURITY-12`: Applicable and satisfied by least-privilege credential mediation and no hardcoded credentials
- `SECURITY-13`: Applicable and satisfied by explicit integrity-preserving mapping and cache rules
- `SECURITY-14`: Applicable and satisfied by observability and failure classification requirements
- `SECURITY-01`, `SECURITY-02`, `SECURITY-04`, `SECURITY-06`, `SECURITY-07`: N/A for this unit
