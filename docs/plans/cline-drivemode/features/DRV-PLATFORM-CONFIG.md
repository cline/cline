# DRV-PLATFORM-CONFIG · Facet catalog and durable config store

Back to [README](../README.md). Phase 0 in [TASK-GRAPH](../TASK-GRAPH.md). Design in [06-platform-config.md](../06-platform-config.md).

## Problem / user value

Every user-facing knob in Drive needs an owner, a scope, a persistence lane, a privacy class, and a phase. Without one mechanism that declares all five, each facet invents its own store and Drive reproduces `cursor-drive:docs/reference/config-schema.md` — a flat namespace with no answer for what happens when a setting changes during a live call, which surface may write it, or whether it is safe to export.

This feature is the mechanism, not a facet. It ships with exactly two entries (`drive.defaults.subMode`, `agent.appearance`) so it is provable without a settings UI, and it is the registry every later config facet lands in. The full inventory of thirty-four facets, with owners and phases, is the inventory table in [06-platform-config.md](../06-platform-config.md).

## Acceptance criteria

- `FacetDef<T>` declares `id`, `title`, `owner`, `scope`, `lane`, `privacy`, `conflict`, `phase`, `defaultValue`, and a schema. The catalog is a const object; `FacetValue<K>` is a mapped type over it. No `Record<string, unknown>` in the public API.
- Three lanes exist and are enforced: `durable` (disk, hub-written), `live` (hub memory, room ops only), `ephemeral` (client-local, never broadcast).
- A durable facet may seed a live facet at room creation and may never overwrite one mid-call. `drive.defaults.subMode` and `room.live.subMode` are separate entries sharing a value schema, and a test proves a disk reload does not move the live value.
- Disk layout is two-tier and version-named: `<workspace>/.cline/drive/{registry,facets}.v1.json` then `~/.cline/drive/…`. Path helpers sit beside `resolveAgentConfigSearchPaths` in `sdk/packages/shared/src/storage/paths.ts`.
- Merge is workspace-over-user per entity id. Deletion across scopes requires an explicit tombstone; file absence means inherit.
- `schemaVersion` appears in both the filename major and the envelope. An unknown major refuses to load with an actionable error rather than parsing partially.
- All writes are atomic tmp-then-rename. Only the hub process writes these files. CLI and webview mutate through hub ops and fail fast when the hub is unreachable.
- `@cline/drive` receives a snapshot and stays pure — no `fs`, no socket, no `participants[]` access. Verified by the package's existing purity constraints from [DRV-KERNEL](DRV-KERNEL.md).
- Privacy class `forbidden` has no facet. Transcript bodies and audio buffers are rejected by the event schemas ([DRV-PRIVACY](DRV-PRIVACY.md)), not configured off.

## Dependencies

- [DRV-EVENTS](DRV-EVENTS.md) (schema home and `CONFIG_SNAPSHOT` broadcast shape), [DRV-KERNEL](DRV-KERNEL.md) (purity contract), [DRV-PRIVACY](DRV-PRIVACY.md) (privacy classes must agree with the schema-level assertions).

## Surfaces touched

- `sdk/packages/shared/src/drive/facets/` (`types.ts`, `schemas.ts`, migrations)
- `sdk/packages/shared/src/storage/paths.ts` (`resolveDriveRegistryPath`, `resolveDriveConfigSearchPaths`)
- `sdk/packages/drive/src/facets/` (catalog const, pure store over a snapshot)
- `sdk/packages/core/src/hub/drive-config/` (disk IO, atomic write, op handlers, `CONFIG_SNAPSHOT` broadcast)

## Agent tasks

- [ ] Define `FacetDef`, lanes, scopes, privacy classes, conflict rules, and the mapped-type catalog access in `@cline/shared`.
  - Owner package: `@cline/shared`
  - Files likely: `sdk/packages/shared/src/drive/facets/types.ts`, `schemas.ts`, tests
  - Verify: `bun -F @cline/shared test`
  - Done when: a wrong-typed `set` fails `bun run types`, and parse rejects an unknown `schemaVersion` major with a named error.
- [ ] Add the two-tier path helpers and the tombstone-aware merge.
  - Owner package: `@cline/shared`
  - Files likely: `sdk/packages/shared/src/storage/paths.ts`, merge unit tests
  - Verify: `bun -F @cline/shared test`
  - Done when: workspace-over-user precedence, inherit-on-absence, and tombstone-hides-user all have passing tests.
- [ ] Ship `DRIVE_FACET_CATALOG` with two entries plus the pure store in the kernel.
  - Owner package: `@cline/drive`
  - Files likely: `sdk/packages/drive/src/facets/catalog.ts`, `store.ts`, tests
  - Verify: `bun -F @cline/drive test`
  - Done when: `get` returns declared defaults for an empty snapshot, `reload` is idempotent, and the package imports nothing from `@cline/core`.
- [ ] Implement the hub-side store: load both scopes, migrate, merge, atomic write, broadcast `CONFIG_SNAPSHOT`.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/hub/drive-config/drive-config-store.ts`, op handlers, tests
  - Verify: `bun -F @cline/core test:unit`
  - Done when: a crash between write and rename leaves the previous file intact in a test, and a `live_wins` facet survives a disk reload during an open room.

## Risks

- **Registry gravity.** A generic config layer invites putting runtime policy in it. Mitigation. The design names three things that stay outside the schema — preset capping, keybinding collisions, contrast floors — and each has a boundary function in [06-platform-config.md](../06-platform-config.md). Review any new "the catalog should also decide…" against that list.
- **Building the mechanism with no consumer.** Mitigation. Exactly two entries ship here, one of which ([DRV-AGENT-PROFILE](DRV-AGENT-PROFILE.md)) is a phase 1 user-visible feature, so the abstraction is proven by use rather than by inspection.
- **A second writer arriving quietly.** A CLI that writes the file directly when the hub is down would look helpful and break the invariant. Mitigation. Fail fast is an acceptance criterion, and the test asserts it.
