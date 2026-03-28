# Logical Components

- `RuntimeShimWrapper`
  - generic external CLI shell
- `RuntimeShimError`
  - normalized failure contract
- `RuntimeStreamTranslator<TChunk>`
  - translation interface for runtime-native stdout
- `ClaudeCodeStreamTranslator`
  - Claude Code reference translator
- `ClaudeCode run orchestrator`
  - command/env assembly on top of the wrapper and translator
