# Helper-to-Custom Skill Migration Checklist

## Skill Information

- **Helper Skill Name**: [TODO]
- **Source Location**: [e.g., `~/.claude/plugins/cache/anthropic-agent-skills/.../skills/<name>`]
- **Target Custom Name**: [TODO]
- **Migration Reason**: [TODO — what project-specific features outgrew the helper scope?]

## Pre-Migration Assessment

- [ ] Helper skill has gained project-specific scripts beyond its original generic scope
- [ ] Helper skill has project-specific references or parsing logic
- [ ] The project-specific features are durable (not one-off)

## Migration Checklist

### Step 1: SKILL.md 생성
- [ ] Create `.agent/skills/<name>/SKILL.md`
- [ ] Add YAML frontmatter with `name` and `description` fields
- [ ] Write skill body: overview, trigger conditions, core workflow, completion gates
- [ ] Document 일시 스크립트 생성 규칙 section (if skill generates scripts)

### Step 2: OpenAI Agent Metadata 생성
- [ ] Create `.agent/skills/<name>/agents/openai.yaml`
- [ ] Set `interface.display_name` — human-readable name
- [ ] Set `short_description` — one-line trigger description
- [ ] Set `default_prompt` — default execution prompt

### Step 3: skills.json 등록
- [ ] Add entry to `.agent/skills/skills.json`
- [ ] Fill required fields: `name`, `path`, `entrypoint`, `description`, `layer`
- [ ] Fill resource fields: `reads`, `writes`, `scripts`, `references`
- [ ] Fill relationship fields: `helperSkills`, `dependsOnSkills` (if applicable)
- [ ] `scripts` array includes only reusable scripts (not temporary ones)

### Step 4: 스크립트 분리 및 복사
- [ ] Identify reusable scripts → copy to `.agent/skills/<name>/scripts/`
- [ ] Identify temporary/project-specific scripts → place in `scripts/` at project root
- [ ] Keep originals in helper location for backward compatibility (if other projects use them)
- [ ] Verify script paths in SKILL.md and skills.json match actual locations

### Step 5: Shared Runtime Link 검증
- [ ] Verify `.claude/skills` is a symlink to `../.agent/skills`
- [ ] Verify `.codex/skills` is a symlink to `../.agent/skills`
- [ ] Verify `.claude/skills/<name>/` and `.codex/skills/<name>/` both resolve correctly
- [ ] Repeat for each active worktree (check `git worktree list`)

### Step 6: 검증
- [ ] `/command` triggers correctly in Claude Code session
- [ ] SKILL.md body loads on trigger
- [ ] Scripts execute without path errors
- [ ] References load correctly

## Post-Migration

- [ ] Update `aidlc-docs/meta-knowledge/knowledge-base.md` with migration lesson
- [ ] Update `aidlc-docs/meta-knowledge/improvement-backlog.md` if follow-up work remains
- [ ] Consider removing backward-compatibility copies after confirming no other consumers
