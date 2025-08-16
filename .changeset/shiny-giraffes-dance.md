---
"claude-dev": minor
---

### New Slash Command: `/gitnote`

- Introduces the `/gitnote` command to create and manage structured, contextual notes attached to Git commits.
- The command creates a "master note" on first use within a task and intelligently updates it on subsequent uses, capturing an evolutionary history of changes.
- Generated notes include machine-readable metadata (`Category`, `User Impact`, `Breaking Change`) to enable automated documentation and release note generation.
