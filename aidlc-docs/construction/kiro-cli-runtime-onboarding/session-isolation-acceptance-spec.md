# Session Isolation Acceptance Spec - Kiro CLI

## Purpose

Validate that Cline uses Kiro CLI as an isolated per-session runtime rather than as a shared process with leaky state.

## Isolation Boundary

Each runtime session must be treated as independent across:

- working directory
- environment variables
- temp directory
- output stream
- transcript capture
- runtime metadata

## Required Scenarios

### Scenario 1. Distinct Working Directories

- Start session A in workspace fixture A.
- Start session B in workspace fixture B.
- Run prompts that reveal the current directory.
- Accept if session A never reports fixture B and session B never reports fixture A.

### Scenario 2. Distinct Environment Markers

- Start session A with `CLINE_RUNTIME_SESSION_ID=A`.
- Start session B with `CLINE_RUNTIME_SESSION_ID=B`.
- Run prompts that echo the marker through the shim-visible environment if supported.
- Accept if each session only observes its own marker.

### Scenario 3. Distinct Temp Artifacts

- Start session A and session B with different temp roots.
- Capture generated temp files or wrapper-side traces.
- Accept if files remain within the assigned temp root per session.

### Scenario 4. Distinct Output Streams

- Run parallel prompts in session A and session B.
- Capture stdout and stderr separately.
- Accept if no output chunk from session A appears in session B capture, and vice versa.

### Scenario 5. Cancellation Containment

- Cancel session A while session B remains active.
- Accept if session B completes normally and no shared failure state is introduced.

### Scenario 6. Failure Containment

- Force a known failure in session A, such as an invalid binary path.
- Run a valid session B in parallel or immediately after.
- Accept if session B succeeds and no cached error state contaminates it.

## Acceptance Criteria

- No cross-session cwd leakage
- No cross-session env leakage
- No cross-session output leakage
- No cross-session cancellation leakage
- No cross-session failure-state leakage
- Runtime metadata remains attributable to the originating session only

## Instrumentation Requirements

- session ID tagging at shim wrapper boundary
- per-session stdout/stderr capture
- per-session execution metadata record
- per-session temp directory assignment

## Non-Goals

- model quality benchmarking
- token usage accuracy benchmarking
- Claude Code feature parity validation

## Exit Decision

Kiro CLI session isolation is acceptable only if all required scenarios pass on at least one Linux platform and one macOS platform representative environment.
