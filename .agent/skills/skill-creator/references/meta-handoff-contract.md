# Meta Handoff Contract

Use this contract when `meta-knowledge` hands work to `skill-creator`.

The handoff should be compact, but it must include enough structure that `skill-creator` does not have to infer the project intent from loose prose.

## Required Fields

- **Mode**: `new skill`, `existing skill refinement`, or `helper promotion`
- **Problem Statement**: What recurring friction or gap needs to be solved?
- **Recurrence Evidence**: What evidence shows this is not a one-off annoyance?
- **Target Artifact**: Which skill or boundary should change?
- **Trigger Intent**: What user phrases, contexts, or workflow situations should cause the skill to activate?
- **Expected Outcome**: What should be better after the change?
- **Backlog Mapping**: Existing backlog item ID(s) or `new`

## Optional Fields

- **Non-goals**: What should stay unchanged?
- **Related Skills**: Which existing skills might overlap?
- **Validation Evidence**: What tests, runtime checks, or examples should prove the change worked?

## Example

```md
Mode: existing skill refinement
Problem Statement: skill-creator accepts meta-knowledge proposals as loose prose, which causes inconsistent interpretation.
Recurrence Evidence:
- multiple skill improvements required follow-up clarification
- runtime-model migration needed extra manual interpretation
Target Artifact: .agent/skills/skill-creator/
Trigger Intent: requests to create or improve project skills after a meta-knowledge pass
Expected Outcome: skill-creator starts from a structured contract and validates the result with executable checks
Backlog Mapping: SC-01, SC-03
Non-goals:
- do not create a new skill
- do not change unrelated runtime policies
Validation Evidence:
- runtime links resolve
- referenced files exist
- lessons applied/N-A summary is present
```

## Routing Rule

If a `meta-knowledge` proposal cannot fill the required fields, stop and complete the contract before editing the target skill.
