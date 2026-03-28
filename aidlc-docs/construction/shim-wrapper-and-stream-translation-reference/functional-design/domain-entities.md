# Domain Entities

- `RuntimeShimExecutionOptions`
  - command, args, cwd, env, stdinPayload, timeoutMs, maxBufferBytes
- `RuntimeShimError`
  - command, failureType, exitCode, stderrOutput
- `RuntimeStreamTranslator<TChunk>`
  - `translateStdout(line)`
  - `flush()`
- `ClaudeCodeStreamTranslator`
  - Claude Code reference implementation of the translator contract
