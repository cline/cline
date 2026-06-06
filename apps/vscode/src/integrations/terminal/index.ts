/**
 * Shared terminal module for both VSCode and Standalone environments.
 *
 * This module provides terminal management functionality that works across:
 * - VSCode Extension (using VSCode's terminal API or background execution)
 * - CLI (using StandaloneTerminalManager)
 * - JetBrains (using StandaloneTerminalManager via cline-core)
 *
 * @example
 * ```typescript
 * import { StandaloneTerminalManager, ITerminalManager } from "@integrations/terminal"
 *
 * const manager: ITerminalManager = new StandaloneTerminalManager()
 * const terminalInfo = await manager.getOrCreateTerminal("/path/to/cwd")
 * const process = manager.runCommand(terminalInfo, "npm install")
 *
 * process.on("line", (line) => console.log(line))
 * await process
 * ```
 */

// Export unified command executor
// Export command orchestrator (shared logic)
// Export standalone terminal implementations
export { StandaloneTerminalManager } from "./standalone/StandaloneTerminalManager"
// Export all types from types.ts
export type { ITerminalManager } from "./types"
