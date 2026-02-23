You are in the `cline/` repo. Your goal is to generate and **apply** high-quality changelog updates for both the VSCode extension and the CLI in one run, leaving file changes uncommitted for human review.

This is a **workflow + skills only** implementation.

- Do not depend on or call any helper script under `scripts/`.
- Orchestrate with this workflow file.
- Delegate inventory/classification and synthesis/application to skills.

Use `git`, `gh`, and `jq`. Assume `gh` authentication is already configured.

<detailed_sequence_of_steps>

# Release Changelog Generation Workflow (Workflow + Skills)

## 0) Startup mode selection (single user choice)

1. Discover release tags:
   - `git tag --list 'v[0-9]*' --sort=-version:refname`
2. Resolve:
   - `CURRENT_TAG = tags[0]`
   - `TEST_TAG = tags[min(10, len(tags)-1)]`
3. If tags are empty or incomplete, run `git fetch --tags` once and retry discovery.
4. If only one release tag exists, do **not** offer test mode.
5. Ask exactly one up-front question with options:
   - `Generate for current release (<CURRENT_TAG>..main)`
   - `Generate for test release (<TEST_TAG>..main)`

No manual tag entry is required in normal flow.

## 1) Resolve range + version labels

1. Set `fromTag` from selected mode (`CURRENT_TAG` or `TEST_TAG`), `toRef=main`.
2. Validate refs with `git rev-parse --verify --quiet <ref>^{}`.
3. Ask for release header version only if it cannot be inferred from context.
4. Required header shape for generated blocks:
   - `## [<version>]`

## 2) Inventory and classify PRs (Skill A)

Call:

- `use_skill("release-pr-inventory")`

Pass this contract to the skill:

- `fromTag`
- `toRef` (default `main`)
- `mode` (`current` or `test`)

Expected result from Skill A:

- complete merged PR inventory for the selected range
- deterministic per-PR classification (`vscode|cli|both|exclude`)
- coverage accounting with status (`included|excluded|unclassified`)
- explicit inclusion/exclusion rationale per PR

Unclassified handling rule:

- Continue to writing even when `unclassified > 0`.
- Do not auto-include unclassified PRs in generated changelog bullets.
- Require explicit reporting of each unclassified PR (number, title, reason) so the user can decide whether to add it manually.

## 3) Synthesize and apply release entries (Skill B)

Call:

- `use_skill("release-changelog-writer")`

Pass this contract to the skill:

- resolved release version label
- scope-filtered inventory from Skill A
- targets:
  - `CHANGELOG.md`
  - `cli/CHANGELOG.md`

Expected result from Skill B:

- style-consistent inserted release blocks in both target files (when scope has includable PRs)
- no-op on a scope when no includable PRs exist
- preserved changelog history
- explicit post-write list of unclassified PRs excluded from auto-generated bullets

## 4) Required conventions for generated changelog content

For each target file:

- first line of inserted block: `## [<version>]`
- section order: `Added`, `Fixed`, `Changed`, `New Contributors`
- omit empty sections
- no code fences, no analysis prose
- bullets are user-facing, concise, and scope-appropriate

Attribution rule:

- For included PRs from external contributors, append `(Thanks @<username>!)` in relevant bullets.
- If contributor status cannot be resolved, avoid false-positive thanks and report attribution uncertainty.

## 5) Verification checklist

Verify and report:

1. Chosen mode and exact range (`fromTag..main`)
2. Included/excluded counts by scope
3. Updated/no-op status for:
   - `CHANGELOG.md`
   - `cli/CHANGELOG.md`
4. Structural validity of inserted blocks:
   - header format
   - section order
   - no empty sections
5. Coverage validity:
   - every included PR represented or explicitly accounted for
6. Unclassified visibility:
   - unclassified PRs are listed explicitly with reasons they were not auto-included
   - summary makes clear user may manually add selected unclassified PRs

## 6) Final response format

End with a concise summary containing:

- chosen mode + tag range
- counts by classification status
- files changed vs no-op
- unclassified PR list (number + reason + short title), if any
- explicit note that unclassified PRs were intentionally excluded from auto-generated entries pending user decision
- suggested review commands:
  - `git --no-pager diff -- CHANGELOG.md`
  - `git --no-pager diff -- cli/CHANGELOG.md`

</detailed_sequence_of_steps>