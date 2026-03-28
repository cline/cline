# Tech Stack Decisions

- Keep `ClaudeCodeHandler` itself intact and migrate only the handler-construction path.
- Introduce a dedicated runtime handler factory registry instead of broad provider-factory rewrites.
- Preserve existing Mocha regression tests and add a runtime-factory registry seam test.
