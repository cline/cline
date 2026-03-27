# Project Deployment Rules

## Single-Source Runtime Architecture

This project uses a strict single-source system for skills:

1. **Source of Truth**: `.agent/skills/<skill-name>/` at project root — where skills are developed and edited
2. **Inventory**: `.agent/skills/skills.json` — single source of truth for registration and bundle metadata
3. **Claude Runtime Link**: `.claude/skills -> ../.agent/skills`
4. **Codex Runtime Link**: `.codex/skills -> ../.agent/skills`

## Canonical Project Namespace

Project-owned workflow assets stay under `.agent/`:

1. `.agent/.aidlc-rule-details/` — vendored foundation rules
2. `.agent/skills/` — only editable skill source
3. `.agent/workflow-bundle/` — workflow metadata and bootstrap bundle

`.claude/` and `.codex/` are runtime adapter directories. They may contain local tool config and runtime links, but they are not valid source-of-truth locations for new skills or support assets.

## Naming And Placement Rules

Before creating or moving anything:

1. Prefer semantic, role-based names over framework names or tool brands
2. Prefer ownership-revealing locations under `.agent/skills/<skill-name>/...`
3. Do not create new project-owned sources under `.claude/` or `.codex/`
4. Avoid duplicated namespace segments or tool-prefixed placement that obscures ownership
5. Do not silently rename existing repo structure during a normal skill pass; separate topology refactors from ordinary skill creation/refinement work

## Shared Data Model Rules For Numbered Stage Skills

When a skill represents one step in a numbered multi-stage workflow such as `seller-stgNN-*`:

1. Reuse the shared data model docs under `aidlc-docs/construction/backend-foundation/functional-design/`
2. Put common run/artifact/evidence/handoff/approval semantics in shared core docs, not in per-stage copies
3. Add stage-specific business payload only through `seller_stgNN_*` extension docs or tables
4. Update the stage catalog when a stage is added, renamed, or reordered
5. Keep artifact roles aligned with the stage output contract
6. Do not let PostgreSQL+pgvector replace Oracle business truth; vector docs should reference Oracle-owned source rows

## Creating A New Skill

### Step 1: Create Skill Directory

```text
.agent/skills/<new-skill>/
├── SKILL.md
├── references/
├── scripts/
├── assets/
│   └── templates/
└── agents/
```

The directory name should still make sense if the underlying framework or IDE changes.

### Step 2: Register In skills.json

Add an entry to `.agent/skills/skills.json` under the `skills` array:

```json
{
  "name": "<skill-name>",
  "path": "<skill-name>",
  "entrypoint": "<skill-name>/SKILL.md",
  "description": "What this skill does and when to use it.",
  "layer": "skill-bundle",
  "reads": [],
  "writes": [],
  "scripts": [],
  "references": [],
  "templates": [],
  "helperSkills": []
}
```

Required fields: `name`, `path`, `entrypoint`, `description`, `layer`

### Step 3: Verify Runtime Links

```bash
readlink .claude/skills
readlink .codex/skills
```

Both links should resolve to `../.agent/skills`.

### Step 4: Runtime Reachability Check

```bash
test -f .claude/skills/<new-skill>/SKILL.md
test -f .codex/skills/<new-skill>/SKILL.md
```

If either check fails, repair the runtime links before continuing.

### Step 5: Inventory Validation

Run an executable check against `skills.json` before finishing:

```bash
python3 - <<'PY'
import json
from pathlib import Path

root = Path('.').resolve()
skills = json.loads((root / '.agent/skills/skills.json').read_text())
errors = []
for skill in skills['skills']:
    entry = skill.get('entrypoint')
    if entry and not (root / '.agent/skills' / entry).exists():
        errors.append((skill['name'], 'entrypoint', entry))
    for key in ['scripts', 'references', 'templates']:
        value = skill.get(key, []) or []
        if isinstance(value, str):
            value = [value]
        for path in value:
            if path and not (root / '.agent/skills' / path).exists():
                errors.append((skill['name'], key, path))
print(errors)
PY
```

Expected result: empty error list.

## Updating An Existing Skill

1. Edit the source at `.agent/skills/<skill-name>/`
2. Keep `.agent/skills/skills.json` in sync
3. Run the same runtime-link and inventory validation checks
4. Confirm the refinement stayed within the existing skill boundary
5. Do not use a normal refinement pass to relocate established repo topology unless the user explicitly requested that refactor
6. For numbered stage skills, update or confirm shared data model docs, stage catalog, and artifact-role mappings

## Helper Skill Promotion

When a helper skill gains project-specific logic:

1. Create `.agent/skills/<name>/SKILL.md` with YAML frontmatter
2. Create `.agent/skills/<name>/agents/openai.yaml` if needed
3. Register in `.agent/skills/skills.json`
4. Copy reusable scripts to `.agent/skills/<name>/scripts/`
5. Verify `.claude/skills/<name>/` and `.codex/skills/<name>/` resolve through the runtime links
6. Verify the relevant IDE trigger works correctly

## Validation Set Summary

Use this minimum executable validation set in every mode:

1. `readlink .claude/skills`
2. `readlink .codex/skills`
3. `test -f .claude/skills/<skill-name>/SKILL.md`
4. `test -f .codex/skills/<skill-name>/SKILL.md`
5. `skills.json` path validation

Also confirm these policy checks before finishing:

6. No new project-owned source files were placed under `.claude/` or `.codex/`
7. The chosen names describe capability/ownership better than tool or framework branding
