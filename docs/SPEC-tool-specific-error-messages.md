# Spec: Tool-Specific Error Messages for Missing Parameters

## Problem

When the model sends a tool call with missing required parameters (e.g., `replace_in_file` without `diff`, `execute_command` without `command`), it gets a generic error:

```
Missing value for required parameter 'diff'. Please retry with complete response.

# Reminder: Instructions for Tool Use
Tool uses are formatted using XML-style tags...
[~30 lines of XML formatting boilerplate]
```

This is not effective. The model often retries with the same mistake or gives up. In SWE-bench evaluation, 11/182 failures (6%) were caused by the model getting stuck in a loop of malformed tool calls that never recover.

`write_to_file` already has progressive, tool-specific guidance (`writeToFileMissingContentError` in `responses.ts`). This spec extends that pattern to the other high-failure tools.

## Scope

Add tool-specific error messages for these tools only (the ones observed failing in SWE-bench):

1. **`replace_in_file`** — missing `diff`
2. **`execute_command`** — missing `command`

Do NOT change error messages for other tools. The generic message is fine for tools where this rarely happens.

## Design

### Changes to `src/core/prompts/responses.ts`

Add two new error functions next to `writeToFileMissingContentError`:

```typescript
replaceInFileMissingDiffError: (relPath: string): string => {
    return (
        `Failed to edit '${relPath}': The 'diff' parameter was empty.\n\n` +
        `The diff parameter must contain SEARCH/REPLACE blocks in this format:\n` +
        "<<<<<<< SEARCH\n" +
        "exact lines to find\n" +
        "=======\n" +
        "replacement lines\n" +
        ">>>>>>> REPLACE\n\n" +
        `Rules:\n` +
        `- The SEARCH block must match existing file content exactly (including whitespace and indentation)\n` +
        `- You can include multiple SEARCH/REPLACE blocks in a single diff parameter\n` +
        `- If you're unsure of the exact content, use read_file first to see the current file`
    )
},

executeCommandMissingCommandError: (): string => {
    return (
        "The 'command' parameter was empty. Provide the shell command to execute.\n\n" +
        "Example:\n" +
        "<execute_command>\n" +
        "<command>cd /path && python -m pytest tests/</command>\n" +
        "<requires_approval>false</requires_approval>\n" +
        "</execute_command>"
    )
},
```

These are short and specific. No `toolUseInstructionsReminder` boilerplate — that's 30 lines of noise about XML formatting that doesn't help when the model knows the format but dropped a parameter.

### Changes to `src/core/task/tools/handlers/WriteToFileToolHandler.ts`

Replace the generic `sayAndCreateMissingParamError(block.name, "diff")` call for `replace_in_file` missing `diff` (line ~117):

```typescript
// Before:
if (block.name === "replace_in_file" && !rawDiff) {
    config.taskState.consecutiveMistakeCount++
    await config.services.diffViewProvider.reset()
    return await config.callbacks.sayAndCreateMissingParamError(block.name, "diff")
}

// After:
if (block.name === "replace_in_file" && !rawDiff) {
    config.taskState.consecutiveMistakeCount++
    await config.services.diffViewProvider.reset()
    const relPath = rawRelPath || "unknown"
    await config.callbacks.say(
        "error",
        `Cline tried to use replace_in_file for '${relPath}' without value for required parameter 'diff'. Retrying...`,
    )
    return formatResponse.toolError(formatResponse.replaceInFileMissingDiffError(relPath))
}
```

### Changes to `src/core/task/tools/handlers/ExecuteCommandToolHandler.ts`

Replace the generic call for `execute_command` missing `command` (line ~103):

```typescript
// Before:
if (!command) {
    config.taskState.consecutiveMistakeCount++
    return await config.callbacks.sayAndCreateMissingParamError(this.name, "command")
}

// After:
if (!command) {
    config.taskState.consecutiveMistakeCount++
    await config.callbacks.say(
        "error",
        "Cline tried to use execute_command without value for required parameter 'command'. Retrying...",
    )
    return formatResponse.toolError(formatResponse.executeCommandMissingCommandError())
}
```

## What NOT to do

- Do NOT add progressive escalation (like `writeToFileMissingContentError` does with its `consecutiveFailures` counter). Those tools have a specific reason — `write_to_file` fails because of output token limits, and the model needs to be steered toward a fundamentally different approach. For `replace_in_file` and `execute_command`, the model just forgot a parameter — a clear reminder of the expected format is sufficient.
- Do NOT change the `sayAndCreateMissingParamError` function signature or the generic `missingToolParameterError`. Other tools still use them and they work fine.
- Do NOT add tool-specific errors for every tool. Only the two listed above have observed high failure rates.

## Files to change

| File | Change |
|------|--------|
| `src/core/prompts/responses.ts` | Add `replaceInFileMissingDiffError` and `executeCommandMissingCommandError` |
| `src/core/task/tools/handlers/WriteToFileToolHandler.ts` | Use `replaceInFileMissingDiffError` for `replace_in_file` missing `diff` |
| `src/core/task/tools/handlers/ExecuteCommandToolHandler.ts` | Use `executeCommandMissingCommandError` for missing `command` |

## Testing

Run existing unit tests — this is a change to error message content only, no behavioral change:

```bash
npm run test:unit
```

Snapshot tests for system prompts are unaffected (error messages aren't part of the system prompt).
