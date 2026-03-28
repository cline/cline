# Technology Stack

## Programming Languages
- TypeScript - Primary language for CLI, extension, core runtime, standalone services, and webview UI
- TSX - React-based UI in CLI Ink components and webview UI
- JavaScript - Build and runtime helper scripts
- Python - Limited test fixtures and skill scripts

## Frameworks
- React - UI foundation for terminal and webview interfaces
- Ink - Terminal rendering framework for CLI UX
- Vite - Webview UI build tooling
- Commander - CLI argument parsing
- ACP SDK - Agent protocol integration for sessions, permissions, and updates

## Infrastructure
- gRPC - Local RPC for ProtoBus and host bridge communication
- SQLite via `better-sqlite3` - Runtime instance and folder lock coordination
- Local filesystem storage - Task history, settings, and cached state

## Build Tools
- npm workspaces - Monorepo dependency and package coordination
- TypeScript compiler - Type checking and declaration generation
- esbuild - CLI and extension bundling
- Biome - Linting and formatting

## Testing Tools
- Vitest - Unit and component tests across CLI and webview
- Playwright - End-to-end browser and runtime flows
- Storybook - Component development for webview UI
