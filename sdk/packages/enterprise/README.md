# @clinebot/enterprise

Enterprise composition layer for the Cline SDK. Provides identity resolution, remote control plane sync, policy materialization, and telemetry configuration without leaking enterprise-specific concerns into `@clinebot/core`.

## Installation

```sh
npm install @clinebot/enterprise
# or
bun add @clinebot/enterprise
```

**Requires Node.js >= 20.**

## Overview

`packages/enterprise` is an optional layer that sits on top of `@clinebot/agents`, `@clinebot/core`, and `@clinebot/shared`. It handles the full enterprise sync lifecycle:

1. Resolve identity via an `IdentityAdapter` (e.g. WorkOS)
2. Fetch a remote config bundle via an `EnterpriseControlPlane`
3. Persist the bundle via an `EnterpriseBundleStore`
4. Materialize managed rules, workflows, and skills to disk via an `EnterprisePolicyMaterializer`
5. Resolve telemetry configuration via an `EnterpriseTelemetryAdapter`
6. Register the result as an `AgentExtension` consumed by `@clinebot/core`

Provider-specific code ends at the adapter boundary. `@clinebot/core` loads materialized files through the same local discovery path it uses for any other instruction files.

## Quick Start

```ts
import { ClineCore } from "@clinebot/core";
import {
  createEnterpriseSessionMessagesArtifactUploader,
  createWorkosControlPlaneAdapter,
  createWorkosIdentityAdapter,
  prepareEnterpriseCoreIntegration,
} from "@clinebot/enterprise";

const runtime = await ClineCore.create({
  backendMode: "local",
  messagesArtifactUploader: createEnterpriseSessionMessagesArtifactUploader(),
  prepare: async (input) =>
    prepareEnterpriseCoreIntegration({
      workspacePath: input.config.workspaceRoot ?? input.config.cwd,
      identity: createWorkosIdentityAdapter({
        resolveIdentity: async (ctx) => {
          // resolve WorkOS identity and return WorkosResolvedIdentity
        },
      }),
      controlPlane: createWorkosControlPlaneAdapter({
        fetchBundle: async (ctx) => {
          // fetch and return an EnterpriseConfigBundle from your control plane
        },
      }),
    }),
});

await runtime.start({
  prompt: "Summarize the current workspace setup.",
  interactive: false,
  config: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    cwd: workspacePath,
    workspaceRoot: workspacePath,
    systemPrompt: "You are a concise assistant.",
    enableTools: true,
    enableSpawnAgent: false,
    enableAgentTeams: false,
  },
});
```

This keeps enterprise as a materialization layer:
- enterprise syncs and writes managed files under the workspace
- core discovers those files through its normal instruction loader and consumes extensions and telemetry through a generic bootstrap seam
- when remote config explicitly sets `enterpriseTelemetry.promptUploading.enabled: true`, the enterprise bootstrap stamps non-sensitive per-session upload metadata and `createEnterpriseSessionMessagesArtifactUploader()` mirrors persisted `messages.json` files into the configured blob store using in-memory credentials scoped to the live session
- there is no enterprise-specific in-memory prompt path inside core

To run the sync step explicitly before constructing the runtime, use `prepareEnterpriseRuntime`:

```ts
import { prepareEnterpriseRuntime } from "@clinebot/enterprise";

const prepared = await prepareEnterpriseRuntime({
  workspacePath,
  identity: workosIdentityAdapter,
  controlPlane: workosControlPlaneAdapter,
});

// prepared.bundle         — the fetched EnterpriseConfigBundle
// prepared.telemetry      — resolved OpenTelemetryClientConfig from @clinebot/shared
// prepared.workflowsDirectories — directories registered for workflow discovery
// prepared.skillsDirectories    — directories registered for skill discovery
// prepared.pluginDefinition     — AgentExtension for @clinebot/core
```

## Core Interfaces

### `IdentityAdapter`

Resolves the current user's enterprise identity session.

```ts
interface IdentityAdapter {
  name: string;
  resolveIdentity(input: IdentityResolveInput): Promise<EnterpriseIdentitySession | undefined>;
}
```

### `EnterpriseControlPlane`

Fetches the remote config bundle for the current identity.

```ts
interface EnterpriseControlPlane {
  name: string;
  fetchBundle(input: EnterpriseControlPlaneFetchInput): Promise<EnterpriseConfigBundle | undefined>;
}
```

### `EnterprisePolicyMaterializer`

Writes managed rules, workflows, and skills to disk.

```ts
interface EnterprisePolicyMaterializer {
  materialize(input: EnterpriseMaterializationInput): Promise<EnterpriseMaterializationResult>;
}
```

### `EnterpriseTelemetryAdapter`

Maps a config bundle to normalized OTLP telemetry settings.

```ts
interface EnterpriseTelemetryAdapter {
  name: string;
  resolveTelemetry(
    bundle: EnterpriseConfigBundle,
    context: EnterpriseSyncContext,
  ): Promise<Partial<OpenTelemetryClientConfig> | undefined> | Partial<OpenTelemetryClientConfig> | undefined;
}
```

`OpenTelemetryClientConfig` is defined in `@clinebot/shared`. Enterprise resolves that shared telemetry shape; it does not define a separate enterprise-only OTEL config contract.

### `EnterpriseConfigBundle`

The normalized data contract produced by the control plane and consumed by the materializer.

```ts
interface EnterpriseConfigBundle {
  source: string;
  version: string;
  remoteConfig?: RemoteConfig;            // from @clinebot/shared
  managedInstructions?: EnterpriseRuleFile[];
  telemetry?: Record<string, unknown>;
  claims?: EnterpriseIdentityClaims;
  metadata?: Record<string, unknown>;
}
```

`RemoteConfig` is defined in `@clinebot/shared` and is the single normalized config contract shared across the SDK. Enterprise providers normalize into this shape; do not redefine it locally.

## Storage

Three file-based store implementations are provided out of the box. Each can be replaced with a custom implementation by passing an alternative to `prepareEnterpriseRuntime`.

| Store | Interface | Default implementation |
|---|---|---|
| Token store | `EnterpriseTokenStore` | `FileEnterpriseTokenStore` |
| Bundle cache | `EnterpriseBundleStore` | `FileEnterpriseBundleStore` |
| Artifact store | `EnterpriseManagedArtifactStore` | `FileSystemEnterpriseManagedArtifactStore` |

For remote chat-history uploads, `createEnterpriseSessionMessagesArtifactUploader()` builds an uploader from enterprise session metadata written by `prepareEnterpriseCoreIntegration(...)`. When the remote bundle includes `enterpriseTelemetry.promptUploading`, core can mirror persisted `messages.json` files into S3, R2, or Azure Blob Storage by passing that uploader to `ClineCore.create(...)`. Uploading is explicit opt-in: `promptUploading.enabled` must be `true`, and persisted session metadata contains only non-secret routing details while access credentials remain in memory for the lifetime of the active session.

## WorkOS Provider

WorkOS adapters are included under `src/providers/workos/`. Use the factory functions to wrap your own WorkOS auth logic without coupling enterprise contracts to WorkOS types:

```ts
import {
  createWorkosIdentityAdapter,
  createWorkosControlPlaneAdapter,
} from "@clinebot/enterprise";
```

`createWorkosIdentityAdapter` accepts a `resolveIdentity` callback that returns a `WorkosResolvedIdentity`. `createWorkosControlPlaneAdapter` accepts a `fetchBundle` callback that returns an `EnterpriseConfigBundle`.

## Managed Instruction Materialization

Rules, workflows, and skills from the remote bundle are written to managed directories on disk, then discovered and loaded through `@clinebot/core`'s standard local file path, the same path used for any other instruction files.

This means:
- Prompt assembly is consistent between local and enterprise-managed instructions
- No special in-memory injection path
- Reload and provenance behavior is predictable

Materialized file paths are resolved via `resolveEnterprisePaths` and reported back in `PreparedEnterpriseRuntime`.

## Package Boundaries

`packages/enterprise` depends on:
- `@clinebot/agents` — for `AgentExtension`
- `@clinebot/shared` — for `RemoteConfig`, `BasicLogger`, and telemetry config contracts

It does not re-implement the agent loop, session host, transport selection, plugin loading, or generic tool registry. Those belong in `@clinebot/agents`, `@clinebot/core`, and other lower-level SDK packages.

A useful boundary test before adding a feature: if it works without org identity, remote admin policy, or enterprise telemetry config, it probably does not belong in this package.

## Package Layout

```
src/
├── index.ts                  # public exports
├── contracts/                # all normalized enterprise contracts
├── auth/                     # EnterpriseAuthService, token lifecycle
├── control-plane/            # EnterpriseSyncService, bundle fetch orchestration
├── identity/                 # IdentityAdapter re-exports
├── materialization/          # FileSystemEnterprisePolicyMaterializer, path resolution
├── providers/workos/         # WorkOS identity and control plane adapters
├── runtime/                  # createEnterprisePlugin, prepareEnterpriseRuntime
├── storage/                  # file-based token, bundle, and artifact stores
└── telemetry/                # RemoteConfigEnterpriseTelemetryAdapter
```
