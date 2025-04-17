# Terminal Output Truncation Implementation Plan

## Objective

When a terminal command produces a very large amount of output, we want to avoid passing the entire output to the language model. Instead, we will:
- Include only the **first 200 lines** of output
- Include only the **last 800 lines** of output
- Insert a clear ellipsis and note in between these two sections, indicating that the output was truncated and how many lines were omitted

This ensures the model receives representative context from both the start and end of the output, while keeping the prompt size manageable and avoiding overwhelming the model with excessive data.

---

## Motivation

- **Performance**: Prevents excessive memory and token usage for very large outputs.
- **Relevance**: The beginning and end of command output are often the most informative (e.g., setup steps and final errors).
- **Clarity**: The model is explicitly informed that output was truncated, reducing confusion.

---

## Implementation Plan

### 1. Identify Where to Truncate

- The truncation should occur **before** passing terminal output to the model, but **after** all output has been collected.
- The best place is in the `executeCommandTool` method in `src/core/task/index.ts`, where the final result string is constructed.

### 2. Truncation Logic

- Define constants:
  - `MAX_BEGINNING_LINES = 200`
  - `MAX_ENDING_LINES = 800`
- If the output is within the limit, pass it through unchanged.
- If the output exceeds the limit:
  - Take the first 200 lines
  - Take the last 800 lines
  - Insert a message such as:
    ```
    [...Output truncated: X lines omitted...]
    ```
    between the two sections.

### 3. Implementation Steps

- [ ] Add a helper function (e.g., `truncateCommandOutput(output: string): string`) to handle the truncation logic.
- [ ] In `executeCommandTool`, apply this function to the final output string before returning it to the model.
- [ ] Ensure the truncation message is clear and includes the number of omitted lines.
- [ ] Add comments to document the behavior.

### 4. Edge Cases & Considerations

- If the output is less than or equal to 1000 lines, do not truncate.
- The truncation should only affect what is sent to the model, not what is streamed to the user interface.
- For extremely large outputs, consider optimizing memory usage by not storing all lines in memory (future improvement).

---

## Example

Suppose a command produces 5000 lines of output. The model will receive:

```
<first 200 lines>
[...Output truncated: 4000 lines omitted...]
<last 800 lines>
```

---

## Next Steps

- Implement the truncation logic as described.
- Test with commands that produce both small and very large outputs.
- Update documentation and code comments as needed.
