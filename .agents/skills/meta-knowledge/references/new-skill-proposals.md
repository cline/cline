# New Skill Proposals

## Purpose

Use this reference when a lesson suggests that improving existing skills or rules is the wrong shape of solution and a new custom skill should be proposed.

## When To Propose A New Skill

Propose a new skill when at least one of these is true:

- the workflow is recurring and distinct enough to deserve its own trigger
- the required references, scripts, or templates would bloat an existing skill
- the lesson cluster is cohesive but not aligned with any current skill boundary
- the process repeatedly requires the same multi-step orchestration
- the expected future reuse is higher than a one-off patch

## When Not To Propose A New Skill

Do not propose a new skill when:

- a small update to an existing skill would solve the issue cleanly
- the lesson is too project-specific and unlikely to recur
- the workflow is mostly a one-time migration or cleanup
- the real problem is a missing rule or template, not a missing skill

## Proposal Contents

Every new skill proposal should include:

- proposed skill name
- short problem statement
- why existing skills are a poor fit
- trigger conditions
- likely references, scripts, and templates
- expected value if the skill is created
- whether creation should happen now or later

## Approval Rule

`meta-knowledge` may recommend a new skill, but it should not create one automatically.

If the user approves the proposal, transition into `$skill-creator`.
