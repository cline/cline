# Business Rules

- Claude Code must be built through a runtime handler factory before raw provider fallback.
- Legacy `claude-code` provider keys and settings must remain valid.
- The migration must not require controller or task-layer call-site changes.
- Non-Claude runtimes remain on the existing provider factory path until migrated.
