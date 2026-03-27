# AIDLC Integration

## Purpose

This reference defines how `aidlc-discovery-sprint` must integrate with AIDLC artifacts during each sprint.

## Required Read Order

Read these files before planning or executing a sprint:

1. `aidlc-docs/aidlc-state.md`
2. `aidlc-docs/audit.md`
3. Relevant DISCOVERY files under `aidlc-docs/discovery/`
4. Relevant INCEPTION files under `aidlc-docs/inception/`

## Mandatory Artifact Checks

At sprint start, confirm:

- The current lifecycle state recorded in `aidlc-docs/aidlc-state.md`
- Whether DISCOVERY is marked complete even though unfinished work remains
- Which screen or sprint artifacts already exist
- Which INCEPTION documents govern the sprint scope

## Mandatory Audit Behavior

Every meaningful interaction must be reflected in `aidlc-docs/audit.md`.

Required audit characteristics:

- Use ISO 8601 timestamps
- Preserve complete raw user input when logging user messages
- Record the AI action taken, not just the result
- Append to the file instead of overwriting it

Use `scripts/append_audit_entry.py` when it reduces manual formatting errors.

## State Synchronization Rules

When the sprint changes DISCOVERY status in a meaningful way, check whether `aidlc-docs/aidlc-state.md` also needs an update.

Common triggers:

- DISCOVERY was previously marked complete but is now reopened
- A new sprint is formally started
- A previously placeholder area becomes approved for follow-on work
- A blocking issue changes the next planned phase

## Planning And Checkbox Rules

If a sprint plan file contains checkboxes, update them in the same interaction where the work is completed.

At minimum, each active sprint should leave behind:

- A sprint brief or equivalent scoped plan
- Updated DISCOVERY artifacts
- A sprint review or equivalent summary
- Validation status
- Next sprint backlog

## Cross-Phase Feedback

DISCOVERY can change upstream documents.

When that happens, do not silently update downstream artifacts only. First determine whether the finding belongs in:

- requirements
- user stories
- application design

Use `references/inception-feedback.md` to classify and route the feedback.
