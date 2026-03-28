# NFR Requirements

## Extensibility
- new external runtimes must reuse the shim wrapper contract instead of duplicating raw `execa` wiring

## Reliability
- wrapper failures must be deterministic and fail-closed
- stderr diagnostics must survive normalization for support and debugging

## Performance
- stream translation must remain incremental and line-oriented
- the wrapper must preserve long-running CLI execution limits already used by Claude Code

## Security
- system prompt and stdin payloads must stay inside the process boundary and must not be echoed back in normalized errors
- child process env must preserve explicit credential boundary rules from Unit 2
