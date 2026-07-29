# 02 · Research. Streaming and call architectures

Back to [README](README.md). Synthesized from a dedicated research run over Discord, Zoom, Google Meet, Microsoft Teams, Webex, Slack Huddles, and Twitch engineering sources.

## Core finding

Every product separates a low-volume **signaling/presence plane** (websocket event bus, room state) from a high-volume **media plane** (SFU-routed RTP). For cline-drivemode the "screen" is structured IDE and agent state, so the MVP needs only the signaling plane. Cline's hub daemon (`sdk/packages/core/src/hub/`, discovery, daemon, server, and client adapters over WebSocket) already approximates it.

## Call metaphor map

| Product | Join | Share | Voice | Multi-user | Takeaway for Drive |
|---|---|---|---|---|---|
| **Discord** | Gateway websocket. Client sends `Update Voice State` (op 4), server broadcasts `VOICE_STATE_UPDATE` | "Go Live" is an extra track through the same SFU. Stage channels split speakers and audience | Custom C++ SFU. Server-mute drops packets. `Speaking` events drive UI | Persistent rooms you drop into. Presence via `PRESENCE_UPDATE` with client-side caches | **Best model to copy.** Drop-in rooms, join/leave as state mutations on an event bus, speaking indicators as events, mute enforced server-side |
| **Zoom** | Geolocation-steered to nearest media router. P2P shortcut for 2-party calls | Screen share is a distinct high-priority track | Per-subscriber simulcast layer selection | Zone controllers manage router pools. Host and co-host roles | 2-party fast path stays local. Treat the shared screen as a distinct, quality-prioritized channel |
| **Google Meet** | Signaling authenticates and distributes session metadata. Media path is separate | SFU maps active speakers onto a fixed set of "virtual streams" | Active-speaker detection selects forwarded streams | Signaling failure does not kill active media | Virtual-stream slots. N participants but a fixed small set of render slots. Maps to stage slots for agents |
| **MS Teams** | Call hosted on a regionally chosen media server | Presenter role gates sharing. "Take control" hand-off | Presenters can mute others | Organizer/presenter/attendee capability matrix. Lobby admission | The **bot API** precedent. An agent joins a meeting as a participant. Exactly the agent-in-the-call framing |
| **Webex** | Client probes reachable media nodes, lands on nearest | Same SFU path, host controls sharing | Host and cohost mute controls | Five explicit roles. Video Mesh cascades local clusters outward | Cascading pattern. A local-first node bridges outward only when a remote participant exists |
| **Slack Huddles** | One-click drop-in from a channel or DM. Audio-first | Screen share plus shared cursor. "Coworking space" framing | Janus SFU, later Amazon Chime SDK | Huddle is bound to a channel. The chat thread is the call's text surface | **Best UX to copy.** Lightweight audio-first join, call attached to an existing conversation, media outsourced to an SDK |
| **Twitch** | Viewer join is an HLS subscribe, not a call. Broadcaster is RTMP ingest to CDN | One sharer, many viewers, strict asymmetry | Chat is a separate IRC-derived websocket, seconds behind live | Broadcaster/mod/viewer roles | One-way broadcast with latency. Right pattern for replay and audit of agent sessions. Wrong for pairing |

## Technology building blocks for Drive

- **Signaling/event bus. Needed, and the hub approximates it.** Add Discord-style room semantics on top of the existing WebSocket command/reply and event streams. `call_join` and `call_leave` mutations, `CALL_STATE_UPDATE` and `SPEAKING` broadcast events.
- **Presence. Needed, as a simple registry, not a CRDT.** A hub-owned roster (participant id, role, mute state, sharing flag) with versioned snapshots plus deltas suffices. CRDTs only matter for offline multi-master editing, which is out of scope.
- **Screen share. Structured state, not pixels.** The agent's screen is files touched, diffs, terminal output, and plan progress. Sharing means publishing a state stream on the bus plus a stage-owner pointer (the Meet virtual-stream idea).
- **Voice. Local capture, STT, and TTS. No media server.** For one human and one agent there is no RTP to route. Mic feeds local STT feeds the prompt pipeline. Agent narration feeds TTS. Mute means the hub stops feeding transcripts, the analog of SFU packet drop, enforced hub-side.
- **WebRTC/SFU. Not needed for MVP.** Needed only when two humans must hear each other. Then buy, not build. Chime SDK (Slack's choice) or LiveKit.
- **RTMP/HLS. Not needed.** Possibly relevant later for one-way session replay (Twitch pattern).

## MVP pair-call tech cut (1 user + 1 agent)

- The hub daemon is the "voice server". Add a `call` room object (id, roster, stage owner, mode) with join/leave/mute ops and broadcast state events over the existing transport.
- Zoom's 2-party lesson applies. Everything stays in-process and local. No relay, no TURN, no media server.
- Voice loop is local STT into the pipeline, TTS out, and `SPEAKING` events driving UI indicators.
- The agent holds the stage by default and publishes work-state deltas. The user takes the stage to redirect, per the Teams take-control hand-off.
- The chat panel is bound to the call room, Huddles-style. Text and voice land in the same transcript pipeline.
- Leave is a state mutation. The call object persists as a drop-in channel, not a scheduled meeting.

## Anti-patterns (adopted as plan constraints)

- **Building an SFU or media engine.** Discord and Zoom justify custom media stacks at millions of concurrent users. Slack, at huge scale, still outsourced to Chime SDK.
- **Scheduled-meeting ceremony.** Calendars, lobbies, and join links for a solo-dev pairing loop. Use drop-in semantics.
- **Pixel screen-sharing the IDE** to an agent or user on the same machine. Share structured state.
- **Twitch-style latency chains** anywhere in the interactive path. Multi-second delay kills barge-in.
- **Meeting-grade lobby and compliance controls.** Drive's approval gates already cover the real risk surface, which is agent actions, not room entry.
- **Coupling signaling to media or state streams.** Keep call state authoritative in the hub even if a voice or stage stream drops.

## Sources

- Discord: [2.5M concurrent voice users with WebRTC](https://discord.com/blog/how-discord-handles-two-and-half-million-concurrent-voice-users-using-webrtc), [Gateway docs](https://docs.discord.com/developers/events/gateway.md), [Opcodes](https://docs.discord.com/developers/topics/opcodes-and-status-codes)
- Zoom: [Architected for Reliability](https://library.zoom.com/admin-corner/architecture-and-design/zoom-architected-for-reliability)
- Google Meet: [Meet Media API overview](https://developers.google.com/workspace/meet/media-api/guides/overview)
- Teams: [Meeting roles](https://support.microsoft.com/en-us/teams/meetings/roles-in-microsoft-teams-meetings), [Calls and meetings bots](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/calls-meetings-bots-overview), [Switchboard, SIGCOMM '23](https://www.microsoft.com/en-us/research/wp-content/uploads/2023/08/sigcomm23-final936.pdf)
- Webex: [Video Mesh deployment guide](https://help.webex.com/article/2r5gv7), [Meetings security white paper](https://www.cisco.com/c/en/us/products/collateral/conferencing/webex-meeting-center/white-paper-c11-737588.html)
- Slack: [Calls: Is it you or is it me?](https://slack.engineering/calls-is-it-you-or-is-it-me/), [Slack chooses Amazon Chime SDK](https://aws.amazon.com/blogs/business-productivity/customers-like-slack-choose-the-amazon-chime-sdk-for-real-time-communications/), [Huddles security](https://slack.com/help/articles/115003560786-Security-for-Slack-huddles)
- Twitch: [Ingesting live video at global scale](https://blog.twitch.tv/en/2022/04/26/ingesting-live-video-streams-at-global-scale/), [State of Engineering 2023](https://blog.twitch.tv/en/2023/09/28/twitch-state-of-engineering-2023)
