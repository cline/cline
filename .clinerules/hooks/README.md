# Cline Hooks Documentation

## Context Injection Timing

Context injected by hooks affects **future AI decisions**, not the current tool execution.

### PreToolUse Hook
- Runs BEFORE tool execution
- Can observe tool parameters
- Can block execution with `shouldContinue: false`
- Context affects next AI request

### PostToolUse Hook  
- Runs AFTER tool execution
- Can observe tool results
- Context affects next AI request

## Example Use Cases

1. **Validation**: Block invalid operations
2. **Context Building**: Accumulate workspace knowledge
3. **Logging**: Track tool usage patterns