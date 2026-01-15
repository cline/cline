# Implementation Plan

[Overview]
Create the core scaffold for the TypeScript CLI that replaces the Go CLI.

This initial phase establishes the foundational architecture for the new TypeScript CLI located in `cli-ts/`. The scope is intentionally minimal: entry point, commander setup, HostProvider initialization, and a `cline --version` command. This scaffold will serve as the foundation for all future CLI functionality, designed with testability, modularity, and debuggability as primary concerns.

The key architectural decision is to use the Controller directly (in-process) rather than communicating over gRPC like the Go CLI. This eliminates the need for the protobus service and allows direct reuse of types from `src/shared/` and `src/core/`.

[Types]
Define TypeScript interfaces for CLI configuration and host provider abstraction.

```typescript
// cli-ts/src/types/config.ts
export interface CliConfig {
  verbose: boolean
  configDir: string  // Directory for Cline data storage (default: ~/.cline)
}

// cli-ts/src/types/logger.ts
export interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}
```

[Files]
Create the foundational file structure for the TypeScript CLI.

**New files to be created:**

1. `cli-ts/package.json` - Package configuration with commander dependency
2. `cli-ts/tsconfig.json` - TypeScript configuration extending root tsconfig
3. `cli-ts/src/index.ts` - Main entry point, commander setup
4. `cli-ts/src/commands/version.ts` - Version command implementation
5. `cli-ts/src/core/config.ts` - CLI configuration management
6. `cli-ts/src/core/logger.ts` - Logging utility with verbose mode support
7. `cli-ts/src/core/host-provider-setup.ts` - HostProvider initialization (adapted from src/standalone/cline-core.ts)
8. `cli-ts/src/core/context.ts` - VSCode-like context for standalone mode
9. `cli-ts/src/types/config.ts` - Type definitions for CLI configuration
10. `cli-ts/src/types/logger.ts` - Type definitions for logger interface
11. `cli-ts/tests/unit/commands/version.test.ts` - Unit test for version command
12. `cli-ts/tests/unit/core/logger.test.ts` - Unit test for logger
13. `cli-ts/tests/unit/core/config.test.ts` - Unit test for config
14. `cli-ts/tests/setup.ts` - Test setup file for mocha
15. `cli-ts/.mocharc.json` - Mocha configuration for tests

**Existing files to reference (read-only):**

- `src/standalone/cline-core.ts` - Reference for HostProvider setup pattern
- `src/standalone/vscode-context.ts` - Reference for context initialization
- `src/hosts/host-provider.ts` - HostProvider interface
- `src/registry.ts` - ExtensionRegistryInfo for version

[Functions]
Define the core functions for CLI initialization and command execution.

**New functions:**

1. `cli-ts/src/index.ts`:
   - `main(): Promise<void>` - Entry point, initializes commander and parses args
   - `createProgram(): Command` - Creates and configures the commander program

2. `cli-ts/src/commands/version.ts`:
   - `createVersionCommand(): Command` - Creates the version subcommand
   - `runVersionCommand(config: CliConfig): void` - Executes version display

3. `cli-ts/src/core/config.ts`:
   - `createConfig(options: Partial<CliConfig>): CliConfig` - Creates CLI config with defaults
   - `getDefaultConfigDir(): string` - Returns ~/.cline path

4. `cli-ts/src/core/logger.ts`:
   - `createLogger(verbose: boolean): Logger` - Factory for logger instance
   - `ConsoleLogger` class implementing `Logger` interface

5. `cli-ts/src/core/host-provider-setup.ts`:
   - `setupHostProvider(config: CliConfig, logger: Logger): Promise<void>` - Initializes HostProvider
   - `createCliWebviewProvider(context: ExtensionContext): WebviewProvider` - Stub webview provider
   - `createCliDiffViewProvider(): DiffViewProvider` - Stub diff view provider
   - `createCliTerminalManager(): StandaloneTerminalManager` - Terminal manager instance

6. `cli-ts/src/core/context.ts`:
   - `initializeContext(configDir?: string): { extensionContext, DATA_DIR, EXTENSION_DIR }` - Creates VSCode-like context

[Classes]
Define classes for structured components.

**New classes:**

1. `cli-ts/src/core/logger.ts`:
   - `ConsoleLogger implements Logger` - Console-based logger with verbose mode
     - Constructor: `(verbose: boolean)`
     - Methods: `debug()`, `info()`, `warn()`, `error()`
     - Private: `shouldLog(level: string): boolean`

2. `cli-ts/src/core/host-provider-setup.ts`:
   - `CliWebviewProvider implements WebviewProvider` - Minimal stub for CLI mode
     - Purpose: Satisfies HostProvider interface without VSCode webview
   
   - `CliDiffViewProvider implements DiffViewProvider` - Minimal stub for CLI mode
     - Purpose: Satisfies HostProvider interface without VSCode diff view

[Dependencies]
Add required npm packages for the CLI.

**New dependencies for cli-ts/package.json:**

- `commander` (^12.x) - CLI argument parsing
- `chalk` (^5.x) - Terminal styling (for future use)

**Dev dependencies:**

- `@types/node` (^20.x) - Node.js types
- `mocha` (^10.x) - Test framework
- `chai` (^4.x) - Assertion library
- `sinon` (^17.x) - Mocking library
- `@types/mocha` - Mocha types
- `@types/chai` - Chai types
- `@types/sinon` - Sinon types
- `tsx` (^4.x) - TypeScript execution for development
- `typescript` (^5.x) - TypeScript compiler

**Shared dependencies (from root package.json, accessed via path aliases):**

- Types from `@shared/*` - ExtensionMessage types, etc.
- HostProvider from `@/hosts/host-provider`
- Registry from `@/registry` - Version info

[Testing]
Establish testing infrastructure with unit tests for core components.

**Test framework:** Mocha + Chai + Sinon (consistent with root project)

**Test files:**

1. `cli-ts/tests/unit/commands/version.test.ts`:
   - Test that version command outputs correct version from ExtensionRegistryInfo
   - Test verbose flag behavior
   - Test JSON output format (future-proofing)

2. `cli-ts/tests/unit/core/logger.test.ts`:
   - Test debug messages only shown when verbose=true
   - Test info/warn/error always shown
   - Test message formatting

3. `cli-ts/tests/unit/core/config.test.ts`:
   - Test default config values
   - Test config override merging
   - Test getDefaultConfigDir() returns correct path

**Test commands (to add to cli-ts/package.json):**

```json
{
  "scripts": {
    "test": "mocha",
    "test:watch": "mocha --watch",
    "test:coverage": "c8 mocha"
  }
}
```

[Implementation Order]
Execute implementation in dependency order to maintain buildable state at each step.

1. **Create package.json and tsconfig.json** - Establish project structure and dependencies
2. **Create type definitions** (types/config.ts, types/logger.ts) - Define interfaces first
3. **Create logger module** (core/logger.ts) - Needed by all other modules
4. **Create config module** (core/config.ts) - Needed by host-provider-setup
5. **Create context module** (core/context.ts) - VSCode context abstraction
6. **Create host-provider-setup module** (core/host-provider-setup.ts) - Core initialization
7. **Create version command** (commands/version.ts) - First working command
8. **Create main entry point** (src/index.ts) - Wire everything together
9. **Create test setup** (tests/setup.ts, .mocharc.json) - Test infrastructure
10. **Create unit tests** - Verify all components work correctly
11. **Manual verification** - Run `npx tsx cli-ts/src/index.ts --version` and confirm output
