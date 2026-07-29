# DRV-NOWNEXT · Now/next plan cursor strip

Back to [README](../README.md). Phase 2 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

A good pair partner keeps you oriented. "Now I'm fixing the parser, next I'll rerun the failing tests." The now/next strip surfaces the partner's plan cursor so the user always knows where they are in the work without asking.

## Acceptance criteria

- A slim strip shows the current plan step (now) and the upcoming step (next), derived from plan and task metadata in work events.
- The strip updates as plan-step events arrive. No polling.
- Clicking now or next scrolls the feed to the related messages.
- When no plan exists (quick one-shot tasks), the strip collapses rather than showing empty chrome.

## Dependencies

- DRV-STAGE (layout home), DRV-EVENTS (plan-step events), DRV-NARRATION (related-message refs).

## Surfaces touched

- `apps/cline-hub/src/webview/src/components/NowNext.tsx` (new)
- `apps/cline-hub/src/webview/src/components/ai-elements/{plan,task}.tsx` (consumed)
- `sdk/packages/drive/src/` (plan-cursor derivation if events need enrichment)

## Agent tasks

- [ ] Confirm plan and task metadata reach the hub event stream, and add a plan-step event to shared schemas if the existing session events lack one.
  - Owner package: `@cline/shared` and `@cline/core`
  - Files likely: `sdk/packages/shared/src/drive/events.ts`, session event projector
  - Verify: `bun -F @cline/shared test` and `bun -F @cline/core test:unit`
  - Done when: a simulated planned task yields ordered plan-step events.
- [ ] Build the strip with a pure cursor derivation (events in, now/next out) and collapse-when-absent behavior.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/components/NowNext.tsx`, tests
  - Verify: `bun -F @cline/cline-hub test`
  - Done when: fixtures for planned and unplanned sessions render and collapse correctly.
- [ ] Wire click-to-scroll into the feed and smoke on a live planned task.
  - Owner package: `@cline/cline-hub`
  - Files likely: `NowNext.tsx`, `Chat.tsx`
  - Verify: live smoke via `bun -F @cline/cline-hub dev` with the `control-ui` skill
  - Done when: clicking next lands on the right feed region during a real session.

## Risks

- Cline's plan representation may not emit granular step transitions. Mitigation. The confirm-first task exists to find this early. Worst case the strip shows plan title plus progress fraction, which still orients.
