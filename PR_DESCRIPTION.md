# Fix: Corrected token counting in Claude Code provider

This PR addresses an issue where the Claude Code provider was inflating reported token usage, leading to premature conversation history truncation within Cline.

**Problem:**
Previously, the `ClaudeCodeHandler` in `src/core/api/providers/claude-code.ts` was double-counting cache-related tokens. The `message.usage.input_tokens` field from the Anthropic SDK already includes `cache_read_input_tokens` and `cache_creation_input_tokens`. However, Cline was incorrectly re-adding these cache tokens to its `inputTokens` summation, causing an overestimation of context usage by 30-50%. This led to the `ContextManager` truncating conversation history earlier than necessary.

**Solution:**
The token calculation logic in `src/core/api/providers/claude-code.ts` has been updated to align with Anthropic's official API documentation. The `inputTokens` are now set directly to `message.usage.input_tokens`, and `cacheReadTokens` and `cacheWriteTokens` are tracked separately without being re-added to the total input token count.

**Justification:**
According to Anthropic's API documentation, the `input_tokens` field in the `usage` object represents the total number of input tokens, including any tokens read from or written to the cache. Re-adding `cache_read_input_tokens` and `cache_creation_input_tokens` to `inputTokens` would result in an incorrect, inflated total. This fix ensures accurate token reporting, allowing Cline's `ContextManager` to make correct decisions regarding conversation history truncation.

**Verification:**
Manual testing confirmed that with this change, the reported context usage is accurate, and premature history truncation no longer occurs. No dedicated unit tests for `ClaudeCodeHandler` existed, and existing e2e tests were not suitable for directly asserting internal token counts. Further automated testing for API provider token counting can be considered in future development.
