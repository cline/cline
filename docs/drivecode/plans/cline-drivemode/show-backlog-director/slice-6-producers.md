# Slice 6 · Extra producers

Back to [overview.md](overview.md). Depends on: [slice-2](slice-2-enqueue-rank-tick.md). Strongly recommended after: [slice-5](slice-5-planner-policy.md) so templates get exercised. Unlocks: richer planner catalog.

## Goal

Implement produce tools named in `SHOW_TEMPLATE_KIT` beyond `render_mermaid`.

## Tasks

| ID | Task | Depends on | Owner | Done when |
|---|---|---|---|---|
| 6.1 | `render_plan_card` producer: BankSnapshot / plan title+steps → SVG or structured JSON URI consumed by StickyStagePane (text card OK) | slice 2 materialize switch | `@cline/core` drive-producers | Template `doc.plan` materializes without mermaid |
| 6.2 | `render_code_walkthrough` producer: args `{ path, startLine?, endLine?, caption }` → simple multi-panel text/SVG stub | 6.1 pattern | core | Template `walk.code` works in present/tick |
| 6.3 | `drive_browser_snapshot` producer **or** host-capability fail-closed stub | HostCapabilities | core + hostPort | If `demoCapture` false, enqueue stays planned with reason; if true, URI filled ([DRV-DEMO-SHARE](../features/DRV-DEMO-SHARE.md)) |
| 6.4 | Extend `materializeShowItem` switch by `produce.tool`; unknown tool → leave planned + error event | 6.1–6.3 | core | No throw on unknown; tick skips unready |
| 6.5 | Planner heuristics (slice 5) map events → new templates | slice 5, 6.1–6.2 | drive | Edit→walkthrough; plan posture→plan card |

## Dependency notes

- Can implement 6.1–6.2 in parallel after slice 2.
- 6.3 may block on host capture; ship fail-closed first.
- Privacy: no inline media bytes in events ([DRV-PRIVACY](../features/DRV-PRIVACY.md)).

## Non-goals

- Video / `capture.demo_clip`.
- Pixel share mode.

## Files likely

- `sdk/packages/core/src/hub/drive-producers/*`
- `sdk/packages/core/src/hub/server/handlers/drive-handlers.ts` (`materializeShowItem`)
- `sdk/packages/drive/src/director/showTemplates.ts`
- `sdk/packages/drive/src/hostPort.ts` (capabilities)

## Acceptance

- [ ] Kit tools mermaid + plan_card + walkthrough each have a producer test.
- [ ] Snapshot either produces URI or fails closed with explicit capability error.
- [ ] StickyStagePane renders non-image URIs (text/HTML card) or image SVG.

## Risks

- Sticky pane image-only today — extend pane for document/structured mediaClass.
