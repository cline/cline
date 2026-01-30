/**
 * Entry point for ACP (Agent Client Protocol) mode.
 *
 * When the CLI is invoked with `--acp`, this module sets up the ACP connection
 * and runs Cline as an ACP-compliant agent communicating over stdio.
 *
 * This module exports:
 * - `ClineAgent` - Decoupled agent for programmatic use (no stdio dependency)
 * - `AcpAgent` - Thin wrapper that bridges stdio connection to ClineAgent
 * - `ClineSessionEmitter` - Typed EventEmitter for per-session events
 * - `runAcpMode` - Function to run Cline in stdio-based ACP mode
 *
 * @module acp
 */

import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { Logger } from "@/shared/services/Logger"
import { version as CLI_VERSION } from "../../../package.json"
import { AcpAgent } from "./AcpAgent.js"
import { nodeToWebReadable, nodeToWebWritable } from "./streamUtils.js"

// Re-export classes for programmatic use
export { ClineAgent } from "../agent/ClineAgent.js"
export { ClineSessionEmitter } from "../agent/ClineSessionEmitter.js"
// Re-export types
export type {
	AcpAgentOptions,
	AcpSessionState,
	ClineAcpSession,
	ClineAgentOptions,
	ClineSessionEvents,
	PermissionHandler,
	PermissionResolver,
} from "../agent/types.js"
export { AcpAgent } from "./AcpAgent.js"

/** Original console methods for restoration if needed */
const originalConsole = {
	log: console.log,
	info: console.info,
	warn: console.warn,
	debug: console.debug,
	error: console.error,
}

/**
 * Redirect all console output to stderr.
 *
 * In ACP mode, stdout is reserved exclusively for JSON-RPC communication.
 * All logging must go to stderr to avoid corrupting the protocol stream.
 */
function redirectConsoleToStderr(): void {
	console.log = (...args) => console.error(...args)
	console.info = (...args) => console.error(...args)
	console.warn = (...args) => console.error(...args)
	console.debug = (...args) => console.error(...args)
	// console.error already goes to stderr
}

/**
 * Restore console methods to their original behavior.
 */
export function restoreConsole(): void {
	console.log = originalConsole.log
	console.info = originalConsole.info
	console.warn = originalConsole.warn
	console.debug = originalConsole.debug
	console.error = originalConsole.error
}

export interface AcpModeOptions {
	/** Path to Cline configuration directory */
	config?: string
	/** Working directory (default: process.cwd()) */
	cwd?: string
	/** Enable verbose/debug logging to stderr */
	verbose?: boolean
}

/**
 * Run Cline in ACP mode.
 *
 * This function:
 * 1. Redirects console output to stderr (stdout reserved for JSON-RPC)
 * 2. Sets up the ndJsonStream for stdio communication
 * 3. Creates the AgentSideConnection with our AcpAgent factory
 * 4. Initializes the CLI infrastructure (StateManager, Controller, etc.)
 * 5. Keeps the process alive until the connection closes
 *
 * @param options - Configuration options for ACP mode
 */
export async function runAcpMode(options: AcpModeOptions = {}): Promise<void> {
	redirectConsoleToStderr()

	const outputStream = nodeToWebWritable(process.stdout)
	const inputStream = nodeToWebReadable(process.stdin)
	const stream = ndJsonStream(outputStream, inputStream)
	let agent: AcpAgent | null = null

	new AgentSideConnection((conn) => {
		agent = new AcpAgent(conn, {
			version: CLI_VERSION,
			debug: Boolean(options.verbose),
		})
		return agent
	}, stream)

	let isShuttingDown = false
	const shutdown = async () => {
		if (isShuttingDown) {
			// Force exit on second signal
			process.exit(1)
		}
		isShuttingDown = true
		try {
			await agent?.shutdown()
			restoreConsole()
		} catch (error) {
			Logger.error("[ACP] Error during shutdown:", error)
		}

		process.exit(0)
	}

	process.on("SIGINT", shutdown)
	process.on("SIGTERM", shutdown)

	// Keep the process alive
	// The ndJsonStream will handle stdin events automatically.
	// We need to ensure the process doesn't exit while waiting for input.
	process.stdin.resume()

	// Handle stdin end (client disconnected)
	process.stdin.on("end", shutdown)

	// Handle stdin errors
	process.stdin.on("error", async (error) => {
		Logger.error("[ACP] stdin error:", error)
		await shutdown()
	})

	Logger.info("[ACP] Process is now listening for ACP requests on stdin")
}
