import { ExternalCommentReviewController } from "@hosts/external/ExternalCommentReviewController"
import { ExternalDiffViewProvider } from "@hosts/external/ExternalDiffviewProvider"
import { ExternalWebviewProvider } from "@hosts/external/ExternalWebviewProvider"
import { ExternalHostBridgeClientManager } from "@hosts/external/host-bridge-client-manager"
import { retryOperation } from "@utils/retry"
import * as path from "path"
import { initialize, tearDown } from "@/common"
import { SqliteLockManager } from "@/core/locks/SqliteLockManager"
import { WebviewProvider } from "@/core/webview"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { HostProvider } from "@/hosts/host-provider"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import { StandaloneTerminalManager } from "@/integrations/terminal"
import { HOSTBRIDGE_PORT, waitForHostBridgeReady } from "./hostbridge-client"
import { setLockManager } from "./lock-manager"
import { PROTOBUS_PORT, startProtobusService } from "./protobus-service"
import { log } from "./utils"
import { initializeContext } from "./vscode-context"

let globalLockManager: SqliteLockManager | undefined

async function main() {
	log("\n\n\nStarting cline-core service...\n\n\n")
	log(`Environment variables: ${JSON.stringify(process.env)}`)

	// Parse command line arguments
	const args = parseArgs()

	// Show help if requested
	if (args.help) {
		showHelp()
		process.exit(0)
	}

	// Resource loading assumes cwd is the installation directory
	process.chdir(__dirname)

	// Initialize context with optional custom directory from CLI
	const { extensionContext, DATA_DIR, EXTENSION_DIR } = initializeContext(args.config)

	// Configure ports - CLI args override everything
	if (args.port) {
		process.env.PROTOBUS_ADDRESS = `127.0.0.1:${args.port}`
		// Auto-calculate hostbridge port if not specified
		if (!args.hostBridgePort) {
			process.env.HOST_BRIDGE_ADDRESS = `127.0.0.1:${HOSTBRIDGE_PORT}`
		}
	}
	if (args.hostBridgePort) {
		process.env.HOST_BRIDGE_ADDRESS = `127.0.0.1:${args.hostBridgePort}`
	}

	try {
		// Set up error handlers FIRST (before any service starts)
		setupGlobalErrorHandlers()

		const hostAddress = await waitForHostBridgeReady()

		// The host bridge should be available before creating the host provider because it depends on the host bridge.
		setupHostProvider(extensionContext, EXTENSION_DIR, DATA_DIR)

		const webviewProvider = await initialize(extensionContext)

		// Enable the localhost HTTP server that handles auth redirects.
		AuthHandler.getInstance().setEnabled(true)

		// Now this will throw instead of exit if binding fails
		const protobusAddress = await startProtobusService(webviewProvider.controller)

		// Initialize SQLite lock manager for instance registration
		const dbPath = `${DATA_DIR}/locks.db`
		globalLockManager = new SqliteLockManager({
			dbPath,
			instanceAddress: protobusAddress,
		})

		// Make lock manager available to other modules
		setLockManager(globalLockManager)

		await globalLockManager.registerInstance({
			hostAddress,
		})
		log(`Registered instance in SQLite locks: ${protobusAddress}`)

		// Clean up any orphaned folder locks from dead instances
		globalLockManager.cleanupOrphanedFolderLocks()

		// Mark instance healthy after services are up
		globalLockManager.touchInstance()

		log("All services started successfully")
	} catch (err) {
		log(`FATAL ERROR during startup: ${err}`)
		log(`Cleaning up and shutting down...`)
		await shutdownGracefully(globalLockManager)
		process.exit(1)
	}
}

function setupHostProvider(extensionContext: any, extensionDir: string, dataDir: string) {
	const createWebview = (): WebviewProvider => {
		return new ExternalWebviewProvider(extensionContext)
	}
	const createDiffView = (): DiffViewProvider => {
		return new ExternalDiffViewProvider()
	}
	const createCommentReview = () => new ExternalCommentReviewController()
	const createTerminalManager = () => new StandaloneTerminalManager()
	const getCallbackUrl = (): Promise<string> => {
		return AuthHandler.getInstance().getCallbackUrl()
	}
	// cline-core expects the binaries to be unpacked in the directory where it is running.
	const getBinaryLocation = async (name: string): Promise<string> => path.join(process.cwd(), name)

	HostProvider.initialize(
		createWebview,
		createDiffView,
		createCommentReview,
		createTerminalManager,
		new ExternalHostBridgeClientManager(),
		log,
		getCallbackUrl,
		getBinaryLocation,
		extensionDir,
		dataDir,
	)
}

/**
 * Sets up global error handlers to prevent the process from crashing
 * on unhandled exceptions and promise rejections
 */
function setupGlobalErrorHandlers() {
	// Handle unhandled exceptions
	process.on("uncaughtException", (error: Error) => {
		log(`ERROR: Uncaught exception: ${error.message}`)
		log(`Stack trace: ${error.stack}`)
		// Log the error but don't exit the process
	})

	// Handle unhandled promise rejections
	process.on("unhandledRejection", (reason: any, _promise: Promise<any>) => {
		log(`ERROR: Unhandled promise rejection: ${reason}`)
		if (reason instanceof Error) {
			log(`Stack trace: ${reason.stack}`)
		}
		// Log the error but don't exit the process
	})

	// Handle process warnings (optional, for debugging)
	process.on("warning", (warning: Error) => {
		log(`Process Warning: ${warning.name}: ${warning.message}`)
	})

	// Graceful shutdown handlers
	process.on("SIGINT", () => {
		log("Received SIGINT, shutting down gracefully...")
		shutdownGracefully(globalLockManager).catch((err) => {
			log(`Error during SIGINT shutdown: ${err}`)
			process.exit(1)
		})
	})

	process.on("SIGTERM", () => {
		log("Received SIGTERM, shutting down gracefully...")
		shutdownGracefully(globalLockManager).catch((err) => {
			log(`Error during SIGTERM shutdown: ${err}`)
			process.exit(1)
		})
	})
}

/**
 * Request host bridge shutdown with retry logic and timeout handling.
 * Uses best-effort approach - logs failures but doesn't block shutdown.
 */
async function requestHostBridgeShutdown(): Promise<void> {
	try {
		await retryOperation(3, 2000, async () => {
			await HostProvider.env.shutdown({})
		})
		log("Host bridge shutdown requested successfully")
	} catch (error) {
		log(`Warning: Failed to request host bridge shutdown: ${error}`)
		log("Proceeding with cleanup")
	}
}

/**
 * Gracefully shutdown the cline-core process by:
 * 1. Calling shutdown RPC on the paired host bridge
 * 2. Cleaning up the lock manager entry
 * 3. Tearing down services
 * 4. Exiting the process
 */
async function shutdownGracefully(lockManager?: SqliteLockManager) {
	try {
		// Step 1: Tell the paired host bridge to shut down
		log("Requesting host bridge shutdown...")
		if (HostProvider.isInitialized()) {
			await requestHostBridgeShutdown()
		} else {
			log("Warning: HostProvider not initialized, cannot request shutdown")
		}

		// Step 2: Clean up lock manager entry
		log("Cleaning up lock manager entry...")
		try {
			// First unregister the instance
			lockManager?.unregisterInstance()
			// Then clean up any folder locks held by this instance
			lockManager?.cleanupOrphanedFolderLocks()
			lockManager?.close()
			log("Lock manager entry cleaned up successfully")
		} catch (error) {
			log(`Warning: Failed to clean up lock manager: ${error}`)
		}

		// Step 3: Tear down services
		log("Tearing down services...")
		try {
			tearDown()
			log("Services torn down successfully")
		} catch (error) {
			log(`Warning: Failed to tear down services: ${error}`)
		}

		log("Graceful shutdown completed")
	} catch (error) {
		log(`Error during graceful shutdown: ${error}`)
	} finally {
		// Step 4: Exit the process
		process.exit(0)
	}
}

// Parse command line arguments
interface CliArgs {
	port?: number
	hostBridgePort?: number
	config?: string
	help?: boolean
}

function parseArgs(): CliArgs {
	const args: CliArgs = {}
	const argv = process.argv.slice(2)

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		switch (arg) {
			case "--port":
			case "-p":
				args.port = parseInt(argv[++i], 10)
				break
			case "--host-bridge-port":
				args.hostBridgePort = parseInt(argv[++i], 10)
				break
			case "--config":
			case "-c":
				args.config = argv[++i]
				break
			case "--help":
			case "-h":
				args.help = true
				break
		}
	}

	return args
}

function showHelp() {
	console.log(`
Cline Core - Standalone Server

Usage: node cline-core.js [options]

Options:
  -p, --port <port>              Port for the main gRPC service (default: ${PROTOBUS_PORT})
  --host-bridge-port <port>      Port for the host bridge service (default: ${HOSTBRIDGE_PORT})
  -c, --config <path>            Directory for Cline data storage (default: ~/.cline)
  -h, --help                     Show this help message

Environment Variables:
  PROTOBUS_ADDRESS              Override the main service address (format: host:port)
  HOST_BRIDGE_ADDRESS            Override the host bridge address (format: host:port)
`)
}

main()
