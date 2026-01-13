# Model Recommendation Triggers for Copilot Chat
# This is a reference guide - the AI will use these criteria to suggest model upgrades

## Task Complexity Levels

### 🟢 HAIKU is Fine (cheap, fast)
- Simple questions and lookups
- Web searches
- Reading files
- Simple file edits (single line changes)
- Git status, log, simple commands
- Fetching information (issues, docs, etc.)
- Code explanations (short snippets)
- Formatting, linting suggestions

### 🟡 Consider SONNET (balanced)
- Multi-file code changes
- Bug fixing (medium complexity)
- Code refactoring
- Writing new functions/classes
- Code review
- Test writing
- Documentation generation
- Debugging with context

### 🔴 Use OPUS (most powerful)
- Complex bug analysis (multiple systems)
- Architecture decisions
- Large refactoring (10+ files)
- Security analysis
- Performance optimization
- Complex algorithm implementation
- Multi-step reasoning tasks
- Codebase-wide changes
- When Haiku/Sonnet gives poor results

## Trigger Phrases
When I detect these patterns, I'll suggest upgrading:

1. "This requires analyzing multiple files..." → Suggest Sonnet
2. "This is a complex architectural decision..." → Suggest Opus
3. "I'm not confident in this answer..." → Suggest upgrade
4. "This bug involves multiple subsystems..." → Suggest Opus
5. "Let me do a deep analysis..." → Suggest Opus
