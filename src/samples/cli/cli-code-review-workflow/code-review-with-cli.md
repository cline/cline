# Code Review Using Cline CLI Sub-Agent

You are performing a code review using the Cline CLI as a sub-agent to handle specific review tasks.

## Process

1. **Ask for the code to review:**
   Use `ask_followup_question` to get the file path or PR link from the user

2. **Spawn CLI for review:**
   Use `execute_command` to run:
   ```bash
   cline task oneshot "Review this code for: security issues, performance problems, code quality, and best practices" -f <file-path>
   ```

3. **Wait for CLI completion:**
   The `oneshot` command automatically waits for completion (runs in yolo+plan mode)

4. **Present results:**
   Share the CLI's findings with the user and ask if they want:
   - More detailed analysis on specific issues
   - Automated fixes for any problems found
   - A second review with different criteria

## Example

User wants to review `src/api/auth.ts`:

```bash
cline task new "Review this code for security, performance, and best practices" -f src/api/auth.ts --wait
```

The CLI will analyze the file and return detailed findings that you can then discuss with the user.

## Benefits of CLI Sub-Agent Approach

- **Isolation:** The CLI runs in a separate instance, keeping the review isolated
- **Specialization:** The CLI can focus solely on code review without context switching  
- **Parallelization:** You could spawn multiple CLI instances for different files
- **Consistency:** Same review criteria applied across all reviews
