# Component Inventory

## Application Packages
- Root extension package (`package.json`) - Shared agent engine, extension host, controller stack, prompts, storage, and tooling
- `cli` - Terminal UI, ACP agent surface, and embeddable session control plane
- `webview-ui` - IDE-facing frontend for task interaction and review
- `testing-platform` - Test harness utilities for runtime validation

## Infrastructure Packages
- `src/standalone` runtime - Detached local process with ProtoBus gRPC and host bridge integration
- `proto` - Protobuf definitions and generated service contracts

## Shared Packages
- `src/shared` - Message contracts, storage keys, session metrics, and reusable UI/runtime types
- `src/core` - Controller, task engine, storage, permissions, prompts, hooks, and workspace logic
- `src/hosts` - Host-provider abstractions and implementations for VS Code and external runtimes

## Test Packages
- `src/test` - Extension, unit, and E2E fixtures
- `tests/e2e/cli` - CLI-specific end-to-end coverage
- `evals` - Scenario and benchmark-style validation

## Total Count
- **Total Packages**: 10 major component groups
- **Application**: 4
- **Infrastructure**: 2
- **Shared**: 3
- **Test**: 3
