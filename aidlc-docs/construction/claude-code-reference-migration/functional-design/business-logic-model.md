# Business Logic Model

## Overview
Unit 4 treats Claude Code as the first concrete runtime-backed implementation on the new architecture.

## Main Flow
1. provider selection resolves to runtime identity through the Unit 1 registry
2. runtime handler factory registry checks whether the runtime has a dedicated reference implementation
3. Claude Code runtime factory builds the existing `ClaudeCodeHandler` through the new runtime-backed path
4. existing provider-switch fallback remains intact for non-migrated runtimes
