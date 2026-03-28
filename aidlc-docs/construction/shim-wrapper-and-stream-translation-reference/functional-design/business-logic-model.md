# Business Logic Model

## Overview
Unit 3 separates external runtime execution into two bounded responsibilities:
- the shim wrapper owns process launch, stdin wiring, stdout/stderr capture, exit observation, and normalized failure reporting
- the stream translator owns runtime-native stdout interpretation and chunk reconstruction

## Main Flow
1. runtime adapter prepares execution command, args, cwd, env, and stdin payload
2. shim wrapper launches the child process with deterministic stdio settings
3. stdout lines are forwarded to a translator boundary
4. translator emits normalized runtime-native chunks
5. stderr is retained as diagnostics and only surfaced through normalized failure handling
6. process exit is evaluated fail-closed and propagated as a shim error when non-zero

## Claude Code Reference
- Claude Code becomes the reference external runtime for the boundary
- its JSON line parsing is moved behind a dedicated translator
- its process orchestration is reduced to command/env/arg assembly plus error rewriting
