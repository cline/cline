# DRV-AGENT-PROFILE · Agent display name and two ink channels

Back to [README](../README.md). Phase 1 in [TASK-GRAPH](../TASK-GRAPH.md). Design in [06-platform-config.md](../06-platform-config.md).

## Problem / user value

A pair partner you call every day should be yours. Name it what you call it, and make its name and its messages visually its own so a glance at the transcript tells you who is speaking. This is the smallest change that makes Drive feel like a room with someone in it rather than a chat window with a label.

`AgentProfile` is an **overlay** on Cline's existing `ConfiguredAgent` YAML, never a fork of it. Drive owns display name, two independent ink channels, seat role, permission-preset intent, and pack membership. Cline keeps owning prompt, tools, skills, provider, model, and `maxIterations` on the existing two-tier `.cline/agents/` path. A Drive-owned agent store would drift from those files within a week.

## Acceptance criteria

- `AgentProfile` carries `id`, `ref` (`{ kind: "configured", name }` or `{ kind: "builtin", id: "pair_partner" }`), optional `displayName`, `nameInk`, `bodyInk`, and optional `voiceSlotId`, `permissionPreset`, `defaultSubMode`.
- `AgentProfile` **never** carries `systemPrompt`, `tools`, `skills`, `providerId`, `modelId`, or `maxIterations`. A test asserts no Drive-persisted file contains a prompt field.
- `nameInk` styles the byline, roster row, address chip, and call-strip chip. `bodyInk` styles message and narration body text. They are independent; changing one leaves the other alone.
- Inks persist as `{ kind: "token" }` or `{ kind: "palette", index }`. No hex is written to disk.
- Contrast is enforced at resolve, not rejected at input. The resolver derives lightness from the active host theme (OKLCH, per `apps/cline-hub/src/webview/src/index.css`) and clamps to meet the ratio against the message well in both light and dark. On failure it falls back to `foreground` for names and `muted` for bodies and the editor explains why.
- Cline violet is not a default agent ink. A desaturated violet is available as one palette entry; accent stays product chrome per [CLINE-BRAND-TOKENS.md](../../../design/drive-wireframes/CLINE-BRAND-TOKENS.md).
- Defaults: `nameInk` is a palette index from a stable hash of the profile id, so a fresh roster is legible with no settings visit. `bodyInk` is `{ token: "muted" }`. Reset restores exactly these, per field and per profile.
- Editing while seated repaints the roster and transcript on the next broadcast. The hub reprojects appearance onto matching participants in the same op it writes the durable value. No reseat, no reconnect, no client-side participant write.
- `displayName` is a label, never an identity. Addressing, event payloads, `seatSources`, and pack membership all key off `AgentProfileId`. Two profiles may share a display name without anything downstream breaking.
- A `ConfiguredAgent` that disappears while its profile is seated does not evict the seat. The roster marks it stale; new seats for that ref fail `unknown_agent`.
- Two entry points, one op: inline rename in the roster (double-click or `F2` on the focused row) and the Drive settings panel. Both call `drive_config_upsert_profile`.

## Dependencies

- [DRV-PLATFORM-CONFIG](DRV-PLATFORM-CONFIG.md) (catalog and durable store — `agent.appearance` is facet #6), [DRV-ROSTER](DRV-ROSTER.md) (the surface that paints it and hosts inline rename), [DRV-EVENTS](DRV-EVENTS.md) (appearance fields on participant snapshots), [DRV-ROOM-MVP](DRV-ROOM-MVP.md) (seeding at `createOrAttach`).

## Surfaces touched

- `sdk/packages/shared/src/drive/facets/` (`AgentProfile`, `AgentRef`, `InkRef` schemas)
- `sdk/packages/drive/src/facets/resolve.ts` (`resolveSeat`, default ink hash, contrast clamp — pure)
- `sdk/packages/core/src/hub/drive-config/` (`drive_config_upsert_profile`, appearance reprojection on broadcast)
- `apps/cline-hub/src/webview/src/drive/` (roster inline rename, `AgentProfileEditor` with live preview)

## Agent tasks

- [ ] Add `AgentProfile`, `AgentRef`, and `InkRef` schemas with the no-prompt assertion test.
  - Owner package: `@cline/shared`
  - Files likely: `sdk/packages/shared/src/drive/facets/schemas.ts`, tests
  - Verify: `bun -F @cline/shared test`
  - Done when: a profile round-trips, a hex ink is rejected at parse, and a fixture with `systemPrompt` fails strict parse.
- [ ] Implement `resolveSeat` plus the default-ink hash and the theme-derived contrast clamp, all pure.
  - Owner package: `@cline/drive`
  - Files likely: `sdk/packages/drive/src/facets/resolve.ts`, tests
  - Verify: `bun -F @cline/drive test`
  - Done when: precedence is kernel default `<` profile `<` pack override; a low-contrast ink clamps rather than throwing; a missing `ConfiguredAgent` returns `unknown_agent`.
- [ ] Wire the hub op: durable upsert plus appearance reprojection onto seated participants in one broadcast.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/hub/drive-config/`, `collaboration/` tests
  - Verify: `bun -F @cline/core test:unit`
  - Done when: renaming a seated partner produces exactly one `CALL_STATE_UPDATE` with the new name and no reseat, and no client wrote `participants[]`.
- [ ] Build the editor and inline rename with a live two-line preview.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/drive/AgentProfileEditor.tsx`, `Roster.tsx`
  - Verify: `bun -F @cline/cline-hub test`, live smoke via `control-ui`
  - Done when: rename the partner, tint its name, leave bodies default, and see both channels update in roster and transcript without a reload; reset returns to the hashed default.

## Risks

- **Colors that fight the product.** Eight free colors on names and bodies can make the transcript look like a stylesheet test. Mitigation. Body default stays `muted`, accent violet is not a default, and the contrast clamp is arithmetic rather than a review note.
- **Overlay creep.** The next request will be "let me set the model here too". Mitigation. The no-prompt/no-model assertion is a test, and the reason is written down in [06-platform-config.md](../06-platform-config.md): a user who wants a different model authors a different `ConfiguredAgent`.
- **Repaint distraction.** Live repaint mid-turn could be visually noisy. Mitigation. Named as an open fork with a chosen default; the escape hatch is a per-profile "pin appearance for this call".
