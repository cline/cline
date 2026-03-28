# Business Rules - runtime-contract-foundation

## Contract Rules

### BR-01 Canonical Identity
- Every runtime must have a unique canonical runtime ID.
- Aliases may exist, but aliases must resolve to exactly one canonical runtime ID.

### BR-02 Minimum Registration Contract
- Every registered runtime must declare:
  - runtime identity
  - capability declaration
  - invocation contract entry point
  - probe capability declaration
  - translation contract reference

### BR-03 Backward Compatibility Mediation
- Existing Claude Code user-facing configuration must remain resolvable through the runtime contract foundation.
- Legacy provider-centric state may be translated, but translation must be deterministic and auditable.

### BR-04 Capability Explicitness
- Runtime support must be driven by explicit declared capabilities.
- Missing capabilities must be treated as unsupported, not inferred.

### BR-05 Blocking Validation
- A runtime is blocked from execution planning if:
  - canonical identity is missing
  - required contract fields are missing
  - capability declaration is incomplete
  - migration mapping creates ambiguity

### BR-06 Future Runtime Neutrality
- The contract foundation must not encode Claude-specific assumptions as global rules.
- Claude Code may be the reference implementation, but the shared contract must remain runtime-neutral.

### BR-07 Todo Candidate Handling
- Todo-grade runtime candidates such as `gh` may exist in the capability matrix without being treated as approved execution targets.
- Todo-grade candidates must be clearly marked as non-driver implementations.

## Validation Rules

### VR-01 Runtime ID Validation
- Runtime ID must be non-empty.
- Runtime ID must be stable and machine-usable.
- Runtime ID must not collide with another runtime or alias.

### VR-02 Adapter Shape Validation
- Adapter definition must satisfy the shared contract.
- Runtime registration fails if required adapter fields are absent.

### VR-03 Capability Shape Validation
- Capability declarations must be schema-validated.
- Unknown capability flags should be rejected or explicitly versioned.

### VR-04 Migration Mapping Validation
- Legacy provider mappings must produce one target runtime ID.
- Ambiguous mappings must fail validation.

## Error Handling Rules
- Identity collision -> blocking validation error
- Missing adapter field -> blocking validation error
- Unsupported capability request -> blocked status
- Migration ambiguity -> blocking validation error
