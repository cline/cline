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
export type { CommandExecutorConfig, FullCommandExecutorConfig } from "./CommandExecutor"
export { CommandExecutor } from "./CommandExecutor"

// Export command orchestrator (shared logic)
export type { OrchestrationOptions, OrchestrationResult } from "./CommandOrchestrator"
export {
	BUFFER_STUCK_TIMEOUT_MS,
	CHUNK_BYTE_SIZE,
	CHUNK_DEBOUNCE_MS,
	CHUNK_LINE_COUNT,
	COMPLETION_TIMEOUT_MS,
	findLastIndex,
	orchestrateCommandExecution,
} from "./CommandOrchestrator"

// Export interfaces and types
export type {
	ActiveBackgroundCommand,
	CommandExecutorCallbacks,
} from "./ICommandExecutor"

// Export terminal process interface
export type { ITerminalProcess, TerminalProcessEvents } from "./ITerminalProcess"

// Export standalone terminal implementations
export { StandaloneTerminal } from "./standalone/StandaloneTerminal"
export { StandaloneTerminalManager } from "./standalone/StandaloneTerminalManager"
export { StandaloneTerminalProcess } from "./standalone/StandaloneTerminalProcess"
export { StandaloneTerminalRegistry } from "./standalone/StandaloneTerminalRegistry"

// Export shared types
export type {
	ITerminal,
	ITerminalManager,
	ITerminalProcessResult,
	StandaloneTerminalOptions,
	TerminalInfo,
	TerminalProcessResultPromise,
} from "./types"
