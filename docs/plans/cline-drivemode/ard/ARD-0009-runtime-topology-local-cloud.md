# ARD-0009: Runtime topology for local and cloud Drive

## Status

Accepted

## Metadata

- Date: 2026-07-27
- Deciders: Drivecode planning (cline-drivemode)
- Related: D8 in [01-architecture.md](../01-architecture.md), [07-runtime-topology.md](../07-runtime-topology.md), [ARD-0010](ARD-0010-provider-harness-byok.md), DRV-MIC, DRV-TTS, DRV-PRIVACY

## Context

Drive must work for (1) local-only LLMs and (2) cloud providers. Voice STT/TTS sit on that same split. The facet default `stt.backend = webSpeech` is incompatible with an honest local-only story: Chromium Web Speech typically ships audio off-box.

Signaling stays on the hub loopback. LLM routing already exists in `@cline/llms`. What was missing is a named **runtime topology** that declares which egress classes are legal for LLM facts and voice backends together.

## Decision

1. **A session has a `DeploymentProfile`:** `local` | `cloud` | `hybrid`, stored as durable facet `runtime.profile`.
2. **`RuntimeTopology` is an immutable value** composed of profile, `ResolvedLlmEgress` facts, selected STT/TTS backends (via provider ids — see ARD-0010), and an egress ceiling.
3. **`TopologyPolicy.assertLegal` is pure** in `@cline/drive`. It never imports `@cline/llms` and never opens sockets. Core injects `ResolvedLlmEgress` resolved from the seated `ConfiguredAgent`.
4. **Local profile is airgap for LLM and voice.** STT must be `local-worker`. TTS must be browser `speechSynthesis` or local-worker. Web Speech (`platform-cloud` egress) is forbidden. Cloud `ConfiguredAgent` base URLs are forbidden.
5. **Cloud profile** allows cloud LLMs and may use Web Speech or cloud STT/TTS APIs. Default first-install profile is `cloud`.
6. **Hybrid** requires an explicit `runtime.egressCeiling` facet. Combinations that exceed the ceiling fail closed.
7. **Audio never enters hub events.** STT adapters emit text; MuteGate admits utterance text only.
8. **HostCapabilities** expose `voiceTextIngress` (can admit mute-gated text), not boolean STT/TTS engine catalogs.

## Consequences

**Positive**

- Local and cloud users get a clear privacy story.
- Illegal combos fail at the hub boundary with stable reason codes.
- Voice engines stay swappable without rewriting the kernel (ARD-0010).

**Negative**

- Local users need a local STT worker (or text-only until one is installed).
- Hybrid needs careful Settings copy so it is not confused with Local.

## Alternatives considered

- Independent facets with no profile → rejected; users can believe they are “local” while Web Speech uploads.
- Unified cloud realtime multimodal as primary path → rejected; breaks events-first stage and local parity.

## Links

- [07-runtime-topology.md](../07-runtime-topology.md)
- [08-provider-harness.md](../08-provider-harness.md)
