# Shannon Skill

Claude Code skill for autonomous AI pentesting via Shannon.
Wraps the Docker-based Shannon pentester as a `/shannon` slash command.

## Structure
- `SKILL.md` — skill definition (deployed to ~/.claude/skills/shannon/)
- `scripts/setup-shannon.sh` — installer/updater for Shannon
- `scripts/sync.sh` — deploy to ~/.claude, ~/.agents, ~/.codex

## Commands
```bash
bash scripts/sync.sh  # Deploy to all skill locations
```

## Rules
- ALWAYS confirm authorization before running pentests
- NEVER target production systems
- After edits: run `bash scripts/sync.sh` to deploy
