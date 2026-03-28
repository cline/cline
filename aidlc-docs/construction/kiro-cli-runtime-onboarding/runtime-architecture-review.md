# Runtime Architecture Review

## Review Question

Did the implementation realize the original intent of replacing the old Claude CLI single-path integration with an extensible structure wrapped by persistence boundaries, shim layers, and runtime adapters?

## Conclusion

Yes, mostly.

The current implementation is no longer a single as-is Claude CLI path. Both Claude CLI and Kiro CLI now flow through shared runtime seams for:

- runtime registration and selection
- runtime-aware configuration mediation
- persistence boundary ownership
- runtime handler factory indirection
- shim-based subprocess execution

However, the system is not yet fully runtime-native end-to-end. Legacy provider semantics still remain in upper layers.

## What Was Achieved

### 1. Persistence Boundary Wrapping

Configuration flow is now mediated through:

- `cli/src/utils/provider-config.ts`
- `src/core/api/runtime/runtime-config-facade.ts`
- `src/core/api/runtime/persistence-boundary.ts`

This means runtime-specific config writes are no longer spread arbitrarily through raw state calls.

### 2. Shim Layer Wrapping

Execution flow for CLI runtimes is now mediated through:

- `src/core/api/runtime/shim-wrapper.ts`

Both Claude CLI and Kiro CLI use this shim boundary before reaching the external binary.

### 3. Runtime Adapter / Factory Wrapping

Runtime selection now flows through:

- `src/core/api/index.ts`
- `src/core/api/runtime/registry.ts`
- `src/core/api/runtime/runtime-handler-factory-registry.ts`
- `src/core/api/runtime/factories/claude-code.ts`
- `src/core/api/runtime/factories/kiro-cli.ts`

This is the key point where the old single-path Claude integration stopped being special-cased as the only CLI runtime shape.

### 4. Kiro CLI Was Added Through the New Path

Kiro CLI was not integrated by copying the old Claude-only path. It was added through the runtime factory and shim structure, which is the intended architectural direction.

## Current Runtime Paths

See:

- [`current-runtime-paths.excalidraw`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/aidlc-docs/construction/kiro-cli-runtime-onboarding/current-runtime-paths.excalidraw)

## Remaining Gaps

### 1. Provider IDs Still Leak Upward

UI and configuration entry points still primarily speak in `providerId` terms such as:

- `claude-code`
- `kiro-cli`

This means the upper layers are not yet fully runtime-first.

### 2. Legacy Provider Resolution Still Exists Inside `buildApiHandler()`

The current path still resolves:

- provider
- runtimeId
- legacyProvider

So the architecture is wrapped, but it still carries legacy compatibility logic in the hot path.

### 3. Runtime-Specific Handler Classes Still Exist

These are still explicit and runtime-specific:

- `ClaudeCodeHandler`
- `KiroCliHandler`

This is acceptable for now, but it means extensibility is factory-based rather than fully declarative.

### 4. Persistence Boundary Does Not Yet Own Full Session Memory Semantics

The current persistence boundary governs:

- config
- credentials
- capability probes
- execution metadata

It does not yet fully own or abstract all runtime-session memory semantics.

## Merge Recommendation

This work is mergeable as an architectural foundation and MVP runtime onboarding set.

It should be merged with an explicit note that:

- runtime extensibility is materially improved
- Kiro CLI is onboarded through the new runtime seams
- the architecture still contains legacy provider-facing seams that should be reduced in follow-on work
- additional real integration testing is still required before calling the runtime layer complete

## Required Follow-On Work

- reduce provider-first assumptions in upper UI/config layers
- add Kiro stdout normalization for ANSI prompt fragments
- expand real runtime integration coverage beyond the current Linux aarch64 server
- validate macOS and Linux x86_64 runtime matrix
- continue toward a more runtime-native selection and configuration model
