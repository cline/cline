# 11 · Spotlight, mute/deafen, and A2A

Back to [README](README.md). Full plan: [share-and-router/PLAN.md](share-and-router/PLAN.md).

## Spotlight

`room.live.spotlightParticipantId` prioritizes:

1. On-screen show items from that agent’s media bag  
2. Spoken DirectorScript `say` beats  
3. TTS `voiceSlotId` for who is speaking  

Human always controls the Spotlight button. Router/director may switch spotlight under policy (audit event). Agents may request, not steal.

## Per-agent bags

Each seated agent owns `AgentMediaBag` (`showBacklog` + `scripts` + optional `voiceSlotId`). The stage director merges and ranks with spotlight bias.

## Mute ⟂ deafen

| Flag | Effect |
|---|---|
| muted | Cannot speak (no TTS / narration) |
| deafened | Cannot hear (no inbound room/A2A context) |

Hub-enforced. Silent tool work while muted defaults on.

## A2A

Agent-to-agent uses `addressSet: { mode: "agents", agentIds }` with transcript `channel: "a2a"`. No second bus. `spotlightFollowA2A` defaults off.
