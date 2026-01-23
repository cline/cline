/**
 * Entry point for ACP (Agent Client Protocol) mode.
 *
 * When the CLI is invoked with `--acp`, this module sets up the ACP connection
 * and runs Cline as an ACP-compliant agent communicating over stdio.
 *
 * @module acp
 */

import path from "node:path"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import { StandaloneTerminalManager } from "@/integrations/terminal/standalone/StandaloneTerminalManager"
import { ErrorService } from "@/services/error/ErrorService"
import { initializeDistinctId } from "@/services/logging/distinctId"
import { CliCommentReviewController } from "../controllers/CliCommentReviewController.js"
import { CliWebviewProvider } from "../controllers/CliWebviewProvider.js"
import { createCliHostBridgeProvider } from "../controllers/index.js"
import { initializeCliContext } from "../vscode-context.js"
import { AcpAgent } from "./AcpAgent.js"
import { nodeToWebReadable, nodeToWebWritable } from "./streamUtils.js"

/** CLI version - should match the version in index.ts */
const CLI_VERSION = "0.0.0"

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
	// Step 1: Redirect all console output to stderr
	// stdout is reserved for JSON-RPC messages
	redirectConsoleToStderr()

	if (options.verbose) {
		console.error("[ACP] Starting Cline in ACP mode...")
		console.error("[ACP] Version:", CLI_VERSION)
	}

	const workspacePath = options.cwd || process.cwd()

	// Step 2: Initialize CLI context and infrastructure
	const { extensionContext, DATA_DIR, EXTENSION_DIR } = initializeCliContext({
		clineDir: options.config,
		workspaceDir: workspacePath,
	})

	// Initialize host provider with CLI components
	// Note: We use the CLI host bridge provider here for the general infrastructure.
	// File operations delegation to the ACP client happens at the session level:
	// - AcpAgent creates AcpHostBridgeProvider per-session (in newSession/loadSession)
	// - When processing prompts, the agent uses the session's AcpHostBridgeProvider
	//   to delegate file read/write to the client if the client supports it
	// - Similarly, AcpTerminalManager delegates terminal operations to the client
	HostProvider.initialize(
		() => new CliWebviewProvider(extensionContext),
		() => new FileEditProvider(),
		() => new CliCommentReviewController(),
		() => new StandaloneTerminalManager(),
		createCliHostBridgeProvider(workspacePath),
		options.verbose ? (message: string) => console.error("[ACP]", message) : () => {},
		async () => "", // No auth callback URL in ACP mode
		async (name: string) => path.join(process.cwd(), name),
		EXTENSION_DIR,
		DATA_DIR,
	)

	await ErrorService.initialize()
	await StateManager.initialize(extensionContext)

	// Create the webview provider and get the controller
	const webview = HostProvider.get().createWebviewProvider() as CliWebviewProvider
	const controller = webview.controller

	await initializeDistinctId(extensionContext)

	if (options.verbose) {
		console.error("[ACP] CLI infrastructure initialized")
		console.error("[ACP] Data directory:", DATA_DIR)
		console.error("[ACP] Workspace:", workspacePath)
	}

	// Step 3: Set up the JSON-RPC stream over stdio
	// ndJsonStream expects Web Streams, so we convert Node.js streams first
	// Note: The argument order is (writable, readable) - output first, then input
	const outputStream = nodeToWebWritable(process.stdout)
	const inputStream = nodeToWebReadable(process.stdin)
	const stream = ndJsonStream(outputStream, inputStream)

	if (options.verbose) {
		console.error("[ACP] Created ndJsonStream for stdio communication")
	}

	// Track the agent instance for cleanup
	let agent: AcpAgent | null = null

	// Step 4: Create the AgentSideConnection with our agent factory
	const connection = new AgentSideConnection((conn) => {
		if (options.verbose) {
			console.error("[ACP] Creating AcpAgent instance")
		}

		agent = new AcpAgent(conn, {
			version: CLI_VERSION,
			globalStoragePath: DATA_DIR,
			debug: options.verbose,
		})

		// Inject the controller into the agent
		agent.setController(controller)

		return agent
	}, stream)

	if (options.verbose) {
		console.error("[ACP] AgentSideConnection created, waiting for client requests...")
	}

	// Step 5: Set up signal handlers for graceful shutdown
	let isShuttingDown = false

	const shutdown = async (signal: string) => {
		if (isShuttingDown) {
			// Force exit on second signal
			process.exit(1)
		}
		isShuttingDown = true

		if (options.verbose) {
			console.error(`[ACP] ${signal} received, shutting down...`)
		}

		try {
			// Cancel any active task
			const task = controller.task
			if (task) {
				task.abortTask()
			}

			// Flush pending state
			await controller.stateManager.flushPendingState()

			// Dispose controller
			await controller.dispose()

			// Dispose error service
			await ErrorService.get().dispose()

			// Restore console if needed
			restoreConsole()
		} catch (error) {
			if (options.verbose) {
				console.error("[ACP] Error during shutdown:", error)
			}
		}

		process.exit(0)
	}

	process.on("SIGINT", () => shutdown("SIGINT"))
	process.on("SIGTERM", () => shutdown("SIGTERM"))

	// Step 6: Keep the process alive
	// The ndJsonStream will handle stdin events automatically.
	// We need to ensure the process doesn't exit while waiting for input.
	process.stdin.resume()

	// Handle stdin end (client disconnected)
	process.stdin.on("end", async () => {
		if (options.verbose) {
			console.error("[ACP] stdin closed, client disconnected")
		}
		await shutdown("stdin-end")
	})

	// Handle stdin errors
	process.stdin.on("error", async (error) => {
		if (options.verbose) {
			console.error("[ACP] stdin error:", error)
		}
		await shutdown("stdin-error")
	})

	if (options.verbose) {
		console.error("[ACP] Process is now listening for ACP requests on stdin")
	}
}
