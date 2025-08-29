# System Prompt Integration Tests

This directory contains integration tests for the system prompt generation with snapshot testing capabilities.

## Overview

The integration tests validate that system prompts remain consistent across different:
- Model families (Generic, Next-Gen, XS)
- Provider configurations (OpenAI, Anthropic, LMStudio, etc.)
- Context variations (browser enabled/disabled, MCP servers, focus chain, etc.)

## Snapshot Testing

The tests use snapshot testing to detect unintended changes in prompt generation. Snapshots are stored in the `__snapshots__/` directory.

### Running Tests

#### Normal Test Mode
```bash
# Run tests and compare against existing snapshots
npm test
# or
yarn test
```

Tests will **fail** if generated prompts don't match existing snapshots, showing detailed differences.

#### Update Snapshot Mode
```bash
# Update all snapshots with current prompt output
npm test -- --update-snapshots
```

Use this when you've intentionally changed prompt generation and want to update the baseline.

### When Tests Fail

When snapshot tests fail, you'll see a detailed error message showing:
1. **Which snapshot failed** (e.g., `openai_gpt-3-basic.snap`)
2. **Detailed differences** between expected and actual output
3. **Clear instructions** on how to fix the issue

#### Example Failure Output
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ SNAPSHOT MISMATCH: openai_gpt-3-basic.snap
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Expected length: 15420 characters
Actual length: 15456 characters
Line count difference: 245 vs 246

First differences:
Line 23:
  - Expected: You are Cline, an AI assistant created by Anthropic.
  + Actual:   You are Cline, an AI coding assistant created by Anthropic.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 HOW TO FIX:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 📋 Review the differences above to understand what changed
2. 🤔 Determine if the changes are intentional:
   - ✅ Expected changes (prompt improvements, new features)
   - ❌ Unexpected changes (bugs, regressions)

3. 🔄 If changes are correct, update snapshots:
   npm test -- --update-snapshots

4. 🐛 If changes are unintentional, investigate:
   - Check recent changes to prompt generation logic
   - Verify context/configuration hasn't changed unexpectedly
   - Look for dependency updates that might affect output
```

### Workflow

1. **Make changes** to prompt generation code
2. **Run tests** to see if snapshots still match
3. **Review differences** to ensure changes are intentional
4. **Update snapshots** if changes are correct: `npm test -- --update-snapshots`
5. **Commit both** code changes and updated snapshots

### Snapshot Files

Snapshots are stored with descriptive names:
- `openai_gpt-3-basic.snap` - OpenAI GPT-3 with basic context
- `anthropic_claude-sonnet-4-no-browser.snap` - Claude Sonnet 4 without browser support
- `lmstudio_qwen3_coder-no-mcp.snap` - LMStudio Qwen3 Coder without MCP servers
- `old-next-gen-with-focus.snap` - Legacy next-gen prompt with focus chain
- `section-title-comparison.json` - Section title compatibility analysis

### Best Practices

1. **Review all changes** before updating snapshots
2. **Update snapshots atomically** - don't mix code and snapshot changes
3. **Test thoroughly** after updating snapshots
4. **Document significant changes** in commit messages
5. **Consider backward compatibility** when changing prompt structure

## Test Structure

### Model Test Cases
- **Generic Models**: Basic GPT-3 style models
- **Next-Gen Models**: Advanced models like Claude Sonnet 4
- **XS Models**: Compact models like Qwen3 Coder

### Context Variations
- **Basic**: Full context with all features enabled
- **No Browser**: Browser support disabled
- **No MCP**: No MCP servers configured
- **No Focus Chain**: Focus chain feature disabled

### Legacy Compatibility
Tests also validate compatibility with legacy prompt generation to ensure smooth transitions.