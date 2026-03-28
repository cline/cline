# Integration Test Instructions

## Purpose
Validate that the newly introduced runtime foundation integrates cleanly with existing brownfield provider selection flows.

## Test Scenarios

### Scenario 1: Legacy `ApiProvider` → Runtime Registry → Handler Resolution
- **Description**: ensure existing provider values continue resolving through the new runtime seam.
- **Setup**:
  - install dependencies with `npm ci`
  - regenerate protos with `npm run protos`
- **Test Steps**:
  1. run the Unit 1 Claude Code focused validation command
  2. confirm handler selection still resolves to `ClaudeCodeHandler`
- **Expected Results**:
  - output contains `claude-code-registry-ok`
- **Cleanup**:
  - none required

### Scenario 2: Provider-Key Resolution → Runtime-Aware Lookup
- **Description**: ensure model-key lookup still works for existing providers after runtime-aware changes.
- **Setup**:
  - same as Scenario 1
- **Test Steps**:
  1. run repository unit tests if environment allows
  2. inspect any failures involving `provider-keys.ts`
  3. manually validate lookups for current providers if needed with a small `node -r ts-node/register` command
- **Expected Results**:
  - existing providers still resolve to the same underlying settings keys
- **Cleanup**:
  - none required

### Scenario 3: Proto Conversion Compatibility
- **Description**: ensure runtime-aware proto helper additions do not break legacy provider conversions.
- **Setup**:
  - run `npm run protos`
- **Test Steps**:
  1. execute repository build path `npm run ci:build`
  2. watch for conversion or generated-model typing failures
- **Expected Results**:
  - provider conversion remains backward-compatible
- **Cleanup**:
  - none required

### Scenario 4: Kiro CLI Real Runtime Acceptance
- **Description**: ensure the real `kiro-cli` binary can be launched through the new runtime acceptance harness in the same class of conditions that matter for isolated terminal-session execution.
- **Setup**:
  - `kiro-cli` must be installed and authenticated
  - current shell must expose the same `PATH` that Cline will use
- **Test Steps**:
  1. run `npm run test:kiro:acceptance -- --session-id live-acceptance --cwd <workspace> --output /tmp/kiro-live-acceptance.txt`
  2. inspect the normalized JSON result
- **Expected Results**:
  - `status` is `passed`
  - `envMarker` matches the requested session id
  - an output file is written
- **Cleanup**:
  - remove the temporary output file if desired

### Scenario 5: Linux aarch64 Session Isolation Smoke
- **Description**: ensure the current Linux aarch64 server can run parallel Kiro runtime sessions with isolated cwd, env markers, output files, and failure containment.
- **Setup**:
  - current environment must have a working `kiro-cli`
- **Test Steps**:
  1. run `npm run test:kiro:isolation:linux -- --path $(which kiro-cli) --timeout-ms 20000`
  2. inspect the normalized JSON result
- **Expected Results**:
  - top-level `passed` is `true`
  - `distinct_cwd`, `distinct_env_marker`, `distinct_output_files`, `output_capture_integrity`, and `failure_containment` all pass
- **Cleanup**:
  - remove the generated `/tmp/kiro-isolation-*` directory if desired

## Setup Integration Test Environment

### 1. Install and Prepare
```bash
npm ci
npm run protos
```

### 2. Build Integration-Relevant Artifacts
```bash
npm run ci:build
```

## Run Integration Tests

### 1. Execute Existing Integration Suite
```bash
npm run test:integration
```

### 2. Verify Service / Module Interactions
- **Key Interaction Checks**:
  - runtime registry does not break `buildApiHandler()`
  - Claude Code still resolves from legacy provider configuration
  - shared provider-key and proto-conversion helpers remain compatible
  - Kiro CLI real runtime acceptance works through the subprocess harness
  - Linux aarch64 dual-session isolation smoke validates the control-plane boundary
- **Logs Location**:
  - terminal output
  - generated build artifacts under existing repo output paths

### 3. Cleanup
```bash
# No dedicated cleanup is required for the current in-process integration checks.
```
