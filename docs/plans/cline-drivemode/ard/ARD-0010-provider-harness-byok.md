# ARD-0010: Drive provider harness (BYOK) with OOTB default packs

## Status

Accepted

## Metadata

- Date: 2026-07-27
- Deciders: Drivecode planning (cline-drivemode)
- Related: D9 in [01-architecture.md](../01-architecture.md), [08-provider-harness.md](../08-provider-harness.md), [ARD-0009](ARD-0009-runtime-topology-local-cloud.md), [06-platform-config.md](../06-platform-config.md), DRV-PLATFORM-CONFIG

## Context

Users need Drive to work out of the box for local-only and cloud setups, and to **plug-and-play** STT/TTS (and related) technologies without forking the product. Cline already provides LLM BYOK via provider settings and `ConfiguredAgent`. Drive must not invent a second API-key vault or a flat settings bag.

## Decision

1. **LLM is not a Drive provider slot.** Keys, provider modules, and model ids stay in Cline / `@cline/llms` / `.cline/agents/*.yaml`. Drive stores `runtime.profile` and an `AgentRef` for the pair partner only.
2. **Drive owns STT and TTS slots** via `DriveProviderRegistry` and `DriveProviderManifest` documents.
3. **Manifests declare** `id`, `slot` (`stt` | `tts`), `egress`, `backend` discriminator, non-secret `defaultConfig`, and optional workspace/user `modulePath`.
4. **Selection is facet-backed:** `providers.sttId`, `providers.ttsId`, `providers.sttConfig`, `providers.ttsConfig`. The old user-facing `stt.backend` enum is superseded by provider id selection (backend lives inside the manifest).
5. **Secrets never appear in Drive facet JSON.** Schema and CI forbid `apiKey` / `token` fields in provider configs under `.cline/drive/`.
6. **Default packs** are pure `seedFacetsForProfile(profile)` results:
   - `local` → local-worker STT + browser TTS + loopback LLM expectation
   - `cloud` → Web Speech STT + browser TTS + existing Cline agent/provider
   - `hybrid` → explicit egress ceiling; user picks compatible providers
7. **First-install default profile is `cloud`.** If loopback Ollama is detected, Settings suggests Local (checklist, not a wizard).
8. **Plugin trust (MVP):** load manifests only from `<workspace>/.cline/drive/providers/` and `~/.cline/drive/providers/`, plus compiled builtins. No URL install.
9. **Composition root** `createVoiceStack` in `apps/cline-hub` maps selection + registry → `SttPort` / `TtsPort`. UI never imports concrete engine APIs outside adapter modules.
10. **TopologyPolicy** still fail-closes incompatible provider selections under the active profile (ARD-0009).

## Consequences

**Positive**

- OOTB Local and Cloud paths without Drive-specific key entry for cloud users.
- New engines ship as manifest + adapter (open/closed).
- Settings UI stays a facet catalog projection.

**Negative**

- Custom STT requires a trusted workspace/user plugin until more builtins land.
- Authors must keep egress metadata honest or selection is rejected.

## Alternatives considered

- Drive-owned LLM registry with keys in facets → rejected (C3/D7, privacy).
- Flat settings bag → rejected (C1).
- Remote npm/URL plugin install in MVP → rejected (trust).

## Links

- [08-provider-harness.md](../08-provider-harness.md)
- [07-runtime-topology.md](../07-runtime-topology.md)
