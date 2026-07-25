# MATRIX · Workflow ↔ feature coverage

Derived from [05-workflows.md](05-workflows.md) during the leadership planning wave. Keep this table honest when adding workflows.

## Coverage

| Workflow | Features | Gap / notes |
|---|---|---|
| W-01 First run | DRV-DRIVE-TAB, DRV-ROOM-MVP | Hub-down / version-skew UX → ops catalog |
| W-02 Open tab & join | DRV-ROOM-MVP, DRV-DRIVE-TAB, DRV-ROSTER, DRV-PERSONA-CHIP | Phase 1 must |
| W-03 Join from Chat | DRV-TOGGLE | Phase 1 must |
| W-04 Leave | DRV-LEAVE-END | Phase 1 must |
| W-05 End + handoff | DRV-LEAVE-END, DRV-NARRATION, DRV-INTERRUPT | Phase 1 must |
| W-06 Catch up | DRV-STAGE, DRV-NOWNEXT, DRV-TRANSCRIPT, DRV-LEAVE-END | DEC: one factual “since you left” line |
| W-07 Switch rooms | DRV-DRIVE-TAB, DRV-ROOM-MVP | DEC: unfocused = view-only |
| W-08 Hand off a task | DRV-PARTNER-MVP, DRV-NARRATION, DRV-STAGE, DRV-EVENTS | Phase 1 must |
| W-09 Change sub-mode | DRV-MODE-OVERLAY, DRV-KERNEL, DRV-SKILL-PORT | Phase 1 must |
| W-10 Steer mid-turn | DRV-STEER-QUEUE, DRV-HOOK-POLICY | Phase 2 |
| W-11 Raise hand | DRV-INTERRUPT, DRV-KERNEL | Phase 2 |
| W-12 Barge-in revise | DRV-INTERRUPT, DRV-KERNEL, DRV-MIC, DRV-TTS | DEC: revise-not-restart AC on kernel |
| W-13 Plan cursor | DRV-NOWNEXT, DRV-EVENTS | Phase 2 |
| W-14 Room vs agent | DRV-TRANSCRIPT, DRV-ROSTER | Filtered projection MVP |
| W-15 Watch stage | DRV-STAGE, DRV-EVENTS | Phase 2 |
| W-16 Take stage / share | DRV-SHARE, DRV-STAGE | Structured only |
| W-17 See decisions | DRV-NARRATION, DRV-EVENTS | |
| W-18 Address set | DRV-ADDRESS, DRV-ROSTER | Phase 2 |
| W-19 Inspect participant | DRV-PARTICIPANT-SHEET, DRV-ROSTER, DRV-TRANSCRIPT, DRV-DRIVEAGENT-HOME | Phase 1 sheet; home depth Phase 1–2 |
| W-20 Arm mic & speak | DRV-MIC, DRV-TTS | Phase 3 |
| W-21 Wake / sleep | DRV-MIC (deferred section) | Was UNMAPPED |
| W-22 Correct caption | DRV-CAPTIONS, DRV-PRIVACY | Phase 3 |
| W-23 Make it quiet | DRV-TTS, DRV-MIC | Mic ⊥ TTS |
| W-24 Approve high-impact | **DRV-GATES** | Was UNMAPPED |
| W-25 Policy block | **DRV-GATES** | Was UNMAPPED |
| W-26 Privacy verify | DRV-PRIVACY | Phase 0–3 |
| W-27 Ask for specialist | DRV-TEAM-OPT | Phase 4 |
| W-28 Review isolated work | **DRV-ISOLATION** | Was UNMAPPED; hard dep of teamOpt |
| W-29 Dismiss agent | DRV-TEAM-OPT, DRV-ROOM-MVP | Cascade vs pack refcount |
| W-30 Same call in TUI | DRV-CLI-PARITY | Phase 4 |
| W-31 Hub unreachable | DRV-ROOM-MVP + [ops/hub-drive-ops.md](ops/hub-drive-ops.md) | Was UNMAPPED |
| W-32 Handoff document | DRV-LEAVE-END | Phase 1 |
| W-33 Side question / fork | Deferred product spike | Still intentionally unscoped |
| W-34 Confirm heard text | DRV-HOOK-POLICY, DRV-GATES | Rewrite allowlist |
| W-35 Make agent yours | DRV-AGENT-PROFILE, DRV-PLATFORM-CONFIG, DRV-ROSTER | Phase 1 must |
| W-36 Add roster pack | DRV-ROSTER-PACK, DRV-PLATFORM-CONFIG, DRV-ROSTER, DRV-ADDRESS | Phase 2; multi-seat needs teamOpt |
| W-37 Transcript vs profile | DRV-PARTICIPANT-SHEET, DRV-ROSTER, DRV-TRANSCRIPT, DRV-ADDRESS | Phase 1 |
| W-38 Recruit & seat | DRV-RECRUIT, DRV-AGENT-GRAPH, DRV-ROSTER-PACK, DRV-ROOM-MVP | Phase 2 |
| W-39 Accept/reject knowledge | DRV-AGENT-GRAPH, DRV-DRIVEAGENT-HOME, DRV-PRIVACY | Phase 2–3 |

## Features rarely named by workflow ID

| Feature | Role |
|---|---|
| DRV-ADR | Phase 0 scaffolding |
| DRV-CALL-STRIP | Chrome surface used by many flows; ensure Phase 2 gate names it |
| DRV-PLATFORM-CONFIG | Cross-cutting |

## Still intentionally thin

- **W-33** one-shot fork — do not force into DRV-TEAM-OPT; track as future spike after isolation exists.
