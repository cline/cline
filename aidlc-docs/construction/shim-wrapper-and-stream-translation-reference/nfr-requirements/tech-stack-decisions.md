# Tech Stack Decisions

- Keep `execa` as the process launcher to preserve current runtime behavior and timeout/maxBuffer controls.
- Use `readline` line iteration for incremental stdout handling.
- Keep translator parsing runtime-specific and colocated with each integration package.
- Reuse Mocha/Chai test style for skeleton tests to match existing unit patterns.
