---
name: meta-knowledge
description: Turn recurring lessons learned into improvements for project skills, rules, prompts, templates, and process documents. Use when sprint reviews, audit logs, user corrections, validation failures, or workflow friction reveal reusable knowledge that should be captured and applied, including improvements to this skill itself.
---

# Meta Knowledge

## Overview

Use this skill to convert local lessons and repeated friction into durable process improvements instead of letting them disappear in chat history or ad hoc notes.

This skill is for improving how the project works, not just what the product does. It routes evidence into changes for skills, rules, templates, and review loops, and it can also improve `meta-knowledge` itself when its own workflow shows gaps.

## Start Here

Load these sources first:

1. `aidlc-docs/meta-knowledge/knowledge-base.md`
2. `aidlc-docs/meta-knowledge/improvement-backlog.md`
3. Relevant review files under `aidlc-docs/meta-knowledge/reviews/`
4. The active skill or rule files that may need improvement
5. Evidence artifacts such as sprint reviews, audit entries, validation summaries, or user corrections

Then read these references in order:

1. `references/evidence-sources.md`
2. `references/lesson-distillation.md`
3. `references/change-routing.md`
4. `references/new-skill-proposals.md`
5. `references/discovery-integration.md`
6. `references/self-improvement.md`

## When To Use This Skill

Use this skill when any of the following happens:

- a sprint review produces reusable lessons
- a user corrects the process, not just the output
- the same mistake or omission happens repeatedly
- a skill needs better prompts, scripts, templates, or references
- a project rule no longer matches observed workflow needs
- a user corrects where project-owned workflow assets should live
- `aidlc-discovery-sprint` or another custom skill reveals a better operating pattern
- repository topology, naming, or runtime ownership is creating AI confusion or cross-IDE drift
- machine-global state is leaking into what should be a standalone project-local workflow
- this `meta-knowledge` skill shows signs of friction, ambiguity, or blind spots
- the repeated lesson does not fit any existing skill cleanly and may justify a new custom skill

Do not use this skill as the main workflow for product implementation tasks.

## Core Workflow

1. Gather evidence from the active workstream.
2. Distill raw observations into reusable lessons.
3. Decide whether each lesson is local, project-wide, or cross-skill.
4. Route each lesson to the right target:
   - skill
   - new skill proposal
   - rule
   - template
   - script
   - backlog only
   - self-improvement for `meta-knowledge`
   - topology / ownership improvement
5. Record the lesson in the knowledge base.
6. Update the target artifact if the change is justified and safe.
7. Add any remaining work to the improvement backlog.

When the right answer is a new skill, propose it to the user first. Do not create the new skill automatically unless the user approves that direction. After approval, use `$skill-creator` to create or refine it.

## Integration Focus

This skill is designed to work especially well with `aidlc-discovery-sprint`.

The expected handoff from `aidlc-discovery-sprint` is:

- sprint review
- audit slice
- Playwright summary
- next sprint backlog
- any identified skill or rule pain points

Use `references/discovery-integration.md` when the input comes from a DISCOVERY sprint.

## Self-Improvement Rule

This skill may improve itself, but only when there is concrete evidence that:

- its own routing rules are weak
- its templates are missing useful structure
- its scripts create friction
- its guidance is too vague or too rigid

When improving itself, record the reason in the knowledge base first, then update the skill.

## Scripts And Templates

Use bundled scripts when they reduce repeated editing work:

- `scripts/append_meta_insight.py`
- `scripts/scaffold_meta_review.py`
- `scripts/promote_improvement_item.py`

Use templates from `assets/templates/` when creating meta reviews or proposal notes.

## Completion Gates

Do not finish a meta-knowledge pass until all applicable items are handled:

- evidence sources identified
- reusable lessons separated from one-off noise
- target artifacts decided
- knowledge base updated
- improvement backlog updated when work remains
- backlog reconciliation completed: scan improvement-backlog.md for existing items that match work just completed in this pass, and mark them `[x]` with completion date
- topology, naming, and runtime ownership were assessed when the evidence points to repo-structure drift
- self-improvement assessed when this skill is involved
- new-skill creation was considered when existing targets were a poor fit

## Notes

- Prefer small, defensible improvements over abstract methodology changes.
- Do not change a rule or skill just because one case was annoying. Look for recurrence, leverage, or high impact.
- When a lesson belongs upstream in AIDLC artifacts, route it there instead of only patching the local skill.
- When an improvement would create awkward logic inside an existing skill, prefer proposing a new skill instead of overloading the old one.
