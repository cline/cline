# Drive tab · Discord / Slack hybrid

Throwaway prototype. `drive-tab-discord-slack.html` (keys 1/2 for layout variants; accent switcher in the header for the two Cline violet treatments).

Styled from [CLINE-BRAND-TOKENS.md](CLINE-BRAND-TOKENS.md), measured off cline.bot. The Discord reference here is information architecture only — the palette is Cline violet on near-black, never Discord blurple.

## Decision this prototype settles

Should Drive live as a **sidebar tab of channels + call rooms** (Discord/Slack IA), with agents as roster members you can address and inspect, instead of only a Join call control on the existing Chat header?

## Prior art (condensed)

### Discord

- Left rail. Servers → channel list → main chat → optional member list.
- Voice channels nest **connected users under the channel** with speaking rings and mute badges.
- Screen share takes a **Live / hero** slot. Participant grid docks beside or below.
- Clicking a user is identity-first. DMs are separate from the voice room thread.

### Slack

- Workspace channel list. Huddles attach to a channel/DM with a headphones affordance.
- Drop-in join. Channel sidebar shows who is in the huddle.
- Dual screen share, optional draw. Thread/notes can persist back to the channel.
- Less “game voice lobby,” more “start talking in this conversation.”

### What we steal for Drivecode

| Pattern | Source | Drive mapping |
|---|---|---|
| Nested roster under a live call | Discord | Agents under `#router-fix` / voice row |
| Speaking ring + mute badge | Discord | Agent TTS / tool narration activity |
| Drop-in join on a workspace surface | Slack Huddles | Join call without calendar |
| Hero share + docked peers | Discord Live / Slack share | Structured Agent Stage + optional user share |
| Channel vs DM | Both | Call room thread vs per-agent transcript |
| @mention / recipient chips | Slack | Address set. one / many / everyone |

## Information architecture (domain)

```
DriveTab
  Workspace
    TextChannels[]          # async chat (optional later)
    CallRooms[]             # live pair rooms
      Room
        participants[]      # human | agent
        roomTranscript      # everyone-visible
        agentStreams[]      # per-agent private / focused transcript
        stage               # who is sharing (human or agent)
        addressSet          # recipients for next send
```

Addressing is a first-class send parameter. Hotkeys or chips set `everyone | {agentIds…}` before the message hits the hub.

## Variants in the prototype

**A · Discord-leaning.** Server rail + channel list + nested voice roster + member sidebar + stage. Best for “who is in the call” at a glance.

**B · Slack-leaning.** No server rail. Wider channel list. Same call mechanics. Better if Drive sits as one tab inside Cline’s existing chrome.

### Accent treatments (orthogonal to A/B)

**Violet fill.** Solid violet on the selected channel, the active call row, and the primary CTA. Reads as a chat app, unambiguous about focus, and the closest to Discord's colour density.

**Violet edge.** Selection is a violet left edge over a raised surface; only the CTA stays filled. Matches how cline.bot actually spends accent — sparingly, against near-black — and leaves the stage as the brightest thing on screen.

## Recommendation

Ship **A’s IA inside B’s chrome**. One Drive tab in the Cline hub left nav (Slack-like single workspace). Inside it, Discord-style call rows with nested agent roster, room vs agent transcript focus, address chips, and a stage that supports **agent share and user share**.

Keep the existing Chat **Join call** as a shortcut that opens/focuses the active Drive room. Do not make the header toggle the only entry point.

## Product implications for cline-drivecode

1. Add a **Drive** activity / sidebar surface in `apps/cline-hub` (and later CLI list of rooms).
2. Promote agents to **room participants** (already in future multi-user plan). MVP can still be 1 human + 1 pair_partner, but the UI shows the roster shape.
3. Two transcript views. Room thread and per-agent stream.
4. Send path gains `addressSet`. Kernel/hub enforce delivery.
5. Stage accepts `sharer: human | agent`. User share MVP is structured (“pin this editor selection / file / terminal as share payload”). WebRTC pixels stay later.

## Open forks (closed by leadership defaults)

See [DEC-open-product-forks](../../plans/cline-drivemode/decisions/DEC-open-product-forks.md).

1. **Per-agent stream.** MVP = filtered projection of room events. Dedicated private log deferred.
2. **User screen share MVP.** Structured share only (selection / file / terminal pin). Pixels / WebRTC later.
3. **Accent.** Violet edge default (not violet fill density).
4. **Multi-room focus.** Unfocused rooms are view-only; one active runtime room.

## Sources

- Discord voice channel UI patterns (speaking rings, nested users, Live share hierarchy). See [Discord design notes](https://github.com/Khalidabdi1/design-ai/blob/main/design-md/discord/DESIGN.md) and presence-grid writeups.
- [Slack Huddles help](https://slack.com/help/articles/4402059015315-Use-huddles-in-Slack) and Slack’s multi-share / thread persistence posts.
