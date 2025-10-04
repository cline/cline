# Implementation Plan

## Overview
This plan addresses the issue of inflated context space usage reported by Cline when using the Claude Code provider. The problem stems from a double-counting of tokens, specifically cache-related tokens, within Cline's integration with the Claude Code CLI, leading to premature context truncation. The solution involves modifying the token calculation logic in the `claude-code` provider to align with Anthropic's official API documentation, ensuring accurate token reporting.

## Types
No new types will be introduced. Existing types will be re-interpreted based on clarified definitions from Anthropic's API documentation.

## Files
- **`src/core/api/providers/claude-code.ts`**: This is the primary file to be modified.

## Functions
- **`src/core/api/providers/claude-code.ts`**:
  - The `createMessage` generator function will be modified.
  - The logic for calculating `usage.inputTokens`, `usage.cacheReadTokens`, and `usage.cacheWriteTokens` within the `for await (const chunk of claudeProcess)` loop will be adjusted.

## Classes
- **`ClaudeCodeHandler`** (in `src/core/api/providers/claude-code.ts`): The `createMessage` method of this class will be modified.

## Dependencies
No new dependencies will be introduced. No changes to existing dependencies are required.

## Testing
- **Unit Tests**:
  - Add or modify unit tests for `ClaudeCodeHandler` in `src/core/api/providers/claude-code.ts` to verify that `inputTokens` are correctly calculated according to Anthropic's specification (i.e., `message.usage.input_tokens` is used directly, and cache tokens are not re-added).
  - Test cases should include scenarios with and without cache hits to ensure accuracy.
- **Integration Tests**:
  - Conduct integration tests to confirm that the `ContextManager` no longer prematurely truncates conversation history when using the Claude Code provider. This would involve simulating conversations and monitoring the reported `totalTokens` and `contextHistoryDeletedRange`.

## Implementation Order
1.  **Modify `src/core/api/providers/claude-code.ts`**: Adjust the token calculation logic within the `createMessage` method.
2.  **Update Tests**: Implement or modify unit and integration tests to validate the fix.
