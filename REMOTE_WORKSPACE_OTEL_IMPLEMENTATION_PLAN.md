# Minimal implementation plan: remote-workspace telemetry

## Progress

- [x] Reuse the existing VS Code remote-workspace signal from host version metadata
- [x] Add `is_remote_workspace` to shared telemetry metadata in `TelemetryService`
- [x] Ensure the existing `workspace.initialized` event picks up the new metadata automatically
- [x] Add/update automated tests for telemetry metadata derivation and typed fixtures
- [x] Add workspace setup assertions proving `workspace.initialized` is emitted through the existing flow
- [x] Run automated validation (`npm run check-types` and targeted telemetry unit tests)
- [ ] Manually verify `workspace.initialized` in both local and remote VS Code workspaces

## Goal

Capture telemetry when the user opens a **remote workspace** in the Cline VS Code extension, while keeping the change set as small as possible.

For this pass, we only need one new persisted signal:

- `is_remote_workspace: true | false`

We do **not** need to track remote provider type, connection mode, or any more specific remote metadata.

## Minimal approach

The smallest viable change is to reuse the telemetry that already exists and add one boolean attribute to it.

Why this is enough:

- The extension already knows whether the workspace is remote.
- `workspace.initialized` is already emitted during workspace setup.
- `TelemetryService` already adds shared metadata to emitted telemetry.

That means we do **not** need:

- a new telemetry event
- a new counter metric
- a new CLI detector
- a provider-policy change
- a broader telemetry refactor

## Existing behavior we can reuse

These pieces are already in place:

- `src/hosts/vscode/hostbridge/env/getHostVersion.ts`
  - already exposes the extension host's remote-workspace signal
- `src/core/task/latency.ts`
  - already uses that signal for remote cadence tuning
- `src/core/workspace/setup.ts`
  - already emits `workspace.initialized`
- `src/services/telemetry/TelemetryService.ts`
  - already builds shared telemetry metadata and attaches it to events

This is why the minimal change can stay small.

## Minimal code changes

### 1) Add `is_remote_workspace` to telemetry metadata

- [x] Implemented

**File:** `src/services/telemetry/TelemetryService.ts`

Extend `TelemetryMetadata` with:

```ts
is_remote_workspace: boolean
```

Then, inside `TelemetryService.create()`, derive the boolean from the existing host version data and include it in metadata.

Conceptually:

```ts
const hostVersion = await HostProvider.env.getHostVersion({})
const isRemoteWorkspace = /* derive from existing host remote signal */
```

and include:

```ts
is_remote_workspace: isRemoteWorkspace
```

### 2) Rely on the existing `workspace.initialized` event

- [x] Implemented

**File:** `src/core/workspace/setup.ts`

No functional change should be required here.

Once `TelemetryService` includes `is_remote_workspace` in shared metadata, the existing `workspace.initialized` event will automatically carry it.

That gives us the exact telemetry we need for remote workspace openings without introducing a new event.

## Why this is the minimal change set

This plan intentionally avoids extra work that is not required for the immediate goal.

Out of scope for this pass:

- CLI remote-workspace telemetry
- ACP remote-workspace telemetry
- new startup/session telemetry events
- new OTEL-only metrics
- PostHog removal or provider-policy changes
- tracking remote workspace type or provider

If those become important later, they should be follow-up changes.

## Validation

### Automated

Run:

```bash
npm run check-types
npm run test:unit
```

Status:

- [x] `npm run check-types`
- [x] `npm run test:unit -- src/services/telemetry/TelemetryService.test.ts src/services/telemetry/__tests__/TelemetryService.metrics.test.ts`
- [x] `npm run test:unit -- src/core/workspace/__tests__/setup.test.ts src/services/telemetry/TelemetryService.test.ts src/services/telemetry/__tests__/TelemetryService.metrics.test.ts`

### Manual

Verify that `workspace.initialized` carries:

- `is_remote_workspace = false` for a local VS Code workspace
- `is_remote_workspace = true` for a remote VS Code workspace

Status:

- [ ] Local VS Code workspace manual verification
- [ ] Remote VS Code workspace manual verification

Also confirm that the usual metadata is still present:

- `cline_type`
- `extension_version`
- `platform`
- `platform_version`
- `os_type`
- `os_version`

## Files to change

- `src/services/telemetry/TelemetryService.ts`
- tests for telemetry metadata, if needed

That is the minimal implementation plan that satisfies the telemetry need.