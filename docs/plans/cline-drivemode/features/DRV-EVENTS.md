# DRV-EVENTS · Versioned room and drive event schemas

Back to [README](../README.md). Phase 0 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

Every Drive surface (hub webview, TUI, future VS Code and remote clients) must render the same call. Without one versioned event contract, each surface invents its own shapes and multi-user phase 2 becomes a rewrite. This is the scaffold every later feature builds on.

## Acceptance criteria

- `@cline/shared` exports a discriminated union `DriveEvent` with an explicit schema version field on every event.
- Event families cover the five tracks: control (join/leave/mute/stage/mode), conversation (message, narration), work (edit, command, test result, plan step, decision), presence (speaking, typing, status), media (reserved, no members yet).
- `Room`, `Participant` (kind `human | agent`), `DriveHumanRole`, `DriveAgentRole`, and `StageState` types exist and are parseable at boundaries (zod or the repo's existing schema pattern). Room / conversation shapes leave room for `addressSet` on sends and stage `sharer: human | agent` (filled by DRV-ADDRESS / DRV-SHARE without a schema rewrite).
- Exhaustive-switch over the union compiles with a `never` default per repo convention.
- No event type carries raw audio or full transcripts. Payloads are metadata and structured content only (DRV-PRIVACY dependency going the other way. Privacy reviews this schema). Client transcript focus (DRV-TRANSCRIPT) is a projection over these events, not a second persisted store.
- Unit tests cover parse success, parse rejection of unversioned payloads, and round-trip serialization.

## Dependencies

None. This lands first.

## Surfaces touched

- `sdk/packages/shared/src/drive/events.ts` (new)
- `sdk/packages/shared/src/drive/room.ts` (new)
- `sdk/packages/shared/src/index.ts`, `sdk/packages/shared/src/index.browser.ts` (export wiring)

## Agent tasks

- [x] Define `Room`, `Participant`, roles, and `StageState` types with schema parsing.
  - Owner package: `@cline/shared`
  - Files likely: `sdk/packages/shared/src/drive/room.ts`
  - Verify: `bun -F @cline/shared test` and `bun -F @cline/shared typecheck`
  - Done when: types export from the package index and parse tests pass.
- [x] Define the `DriveEvent` discriminated union with version field and the five track families.
  - Owner package: `@cline/shared`
  - Files likely: `sdk/packages/shared/src/drive/events.ts`
  - Verify: `bun -F @cline/shared test`
  - Done when: exhaustive switch over the union compiles and round-trip tests pass.
- [x] Wire exports into both package indexes and rebuild.
  - Owner package: `@cline/shared`
  - Files likely: `sdk/packages/shared/src/index.ts`, `src/index.browser.ts`
  - Verify: `bun run build:sdk` then `bun run types` from `sdk/`
  - Done when: downstream packages resolve the new exports through `dist/`.
- [x] Add a privacy assertion test that no event schema accepts an `audio` or raw-transcript payload field.
  - Owner package: `@cline/shared`
  - Files likely: `sdk/packages/shared/src/drive/events.test.ts`
  - Verify: `bun -F @cline/shared test`
  - Done when: the test fails if someone adds a raw-media field later.

## Risks

- Over-modeling events for multi-user before the MVP proves shapes. Mitigation. Version field plus the media track reserved but empty. Add members only when a consumer exists.
- Schema drift between hub server and webview bundles. Mitigation. Both import from `@cline/shared`, and the browser index exports the same module.
