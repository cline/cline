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
 * import { StandaloneTerminalManager, ITerminalManager } from "@shared/terminal"
 *
 * const manager: ITerminalManager = new StandaloneTerminalManager()
 * const terminalInfo = await manager.getOrCreateTerminal("/path/to/cwd")
 * const process = manager.runCommand(terminalInfo, "npm install")
 *
 * process.on("line", (line) => console.log(line))
 * await process
 * ```
 */

// Export all types
export type {
	ITerminal,
	ITerminalManager,
	ITerminalProcessResult,
	StandaloneTerminalOptions,
	TerminalInfo,
	TerminalProcessResultPromise,
} from "./types"

// Standalone implementations will be exported here after conversion:
// export { StandaloneTerminalProcess } from "./StandaloneTerminalProcess"
// export { StandaloneTerminal } from "./StandaloneTerminal"
// export { StandaloneTerminalRegistry } from "./StandaloneTerminalRegistry"
// export { StandaloneTerminalManager } from "./StandaloneTerminalManager"
