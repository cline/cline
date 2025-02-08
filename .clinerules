# Code Quality Rules

1. Test Coverage:
   - Before attempting completion, always make sure that any code changes have test coverage
   - Ensure all tests pass before submitting changes

2. Lint Rules:
   - Never disable any lint rules without explicit user approval
   - If a lint rule needs to be disabled, ask the user first and explain why
   - Prefer fixing the underlying issue over disabling the lint rule
   - Document any approved lint rule disabling with a comment explaining the reason

3. Logging Guidelines:
   - Always instrument code changes using the logger exported from `src\utils\logging\index.ts`.
     - This will facilitate efficient debugging without impacting production (as the logger no-ops outside of a test environment.)
   - Logs can be found in `logs\app.log`
     - Logfile is overwritten on each run to keep it to a manageable volume.


# Adding a New Setting

To add a new setting that persists its state, follow the steps in cline_docs/settings.md
