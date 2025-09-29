import { ExternalDiffViewProvider } from "@hosts/external/ExternalDiffviewProvider"
import { ExternalWebviewProvider } from "@hosts/external/ExternalWebviewProvider"
import { ExternalHostBridgeClientManager } from "@hosts/external/host-bridge-client-manager"
import { WebviewProviderType } from "@shared/webview/types"
import { retryOperation } from "@utils/retry"
import os from "os"
import path from "path"
import { initialize, tearDown } from "@/common"
import { SqliteLockManager } from "@/core/locks/SqliteLockManager"
import { WebviewProvider } from "@/core/webview"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { HostProvider } from "@/hosts/host-provider"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import { checkPortAvailability } from "./port-checker"
import { startProtobusService, waitForHostBridgeReady } from "./protobus-service"
import { log, SETTINGS_SUBFOLDER } from "./utils"
import { createExtensionContext } from "./vscode-context"

// Default ports
export const DEFAULT_PROTOBUS_PORT = 26040
export const DEFAULT_HOSTBRIDGE_PORT = 26041

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
  -p, --port <port>              Port for the main gRPC service (default: ${DEFAULT_PROTOBUS_PORT})
  --host-bridge-port <port>      Port for the host bridge service (default: ${DEFAULT_HOSTBRIDGE_PORT})
  -c, --config <path>            Directory for Cline data storage (default: ~/.cline or CLINE_DIR env var)
  -h, --help                     Show this help message

Environment Variables:
  PROTOBUS_ADDRESS              Override the main service address (format: host:port)
  HOSTBRIDGE_ADDRESS            Override the host bridge address (format: host:port)
  CLINE_DIR                     Default Cline data directory (overridden by --config flag)
`)
}

async function main() {
	// Parse command line arguments
	const args = parseArgs()

	// Show help if requested
	if (args.help) {
		showHelp()
		process.exit(0)
	}

	// Configure ports from arguments or env vars
	let protobusPort = DEFAULT_PROTOBUS_PORT
	let hostBridgePort = DEFAULT_HOSTBRIDGE_PORT

	if (args.port) {
		protobusPort = args.port
		// If only port is specified, calculate hostbridge port as port + 1000
		if (!args.hostBridgePort) {
			hostBridgePort = protobusPort + 1000
		}
	}
	if (args.hostBridgePort) {
		hostBridgePort = args.hostBridgePort
	}

	// Set environment variables for the services to use
	if (!process.env.PROTOBUS_ADDRESS) {
		process.env.PROTOBUS_ADDRESS = `localhost:${protobusPort}`
	}
	if (!process.env.HOSTBRIDGE_ADDRESS) {
		process.env.HOSTBRIDGE_ADDRESS = `localhost:${hostBridgePort}`
	}

	// Configure Cline directory from CLI args, env var, or default
	// Priority: --config flag > CLINE_DIR env var > ~/.cline default
	const clineDir = args.config || process.env.CLINE_DIR || `${os.homedir()}/.cline`

	log("\n\n\nStarting cline-core service...\n\n\n")
	log(`Using Protobus port: ${protobusPort}`)
	log(`Using Host Bridge port: ${hostBridgePort}`)
	log(`Using Cline directory: ${clineDir}`)

	// Initialize SQLite lock manager for instance registration
	const dbPath = `${clineDir}/${SETTINGS_SUBFOLDER}/locks.db`
	// Use host:port everywhere (no scheme)
	const fullAddress = `localhost:${protobusPort}`
	let lockManager: SqliteLockManager | undefined
	try {
		lockManager = new SqliteLockManager({
			dbPath,
			instanceAddress: fullAddress,
		})

		// Check port availability before proceeding
		log(`Checking port availability for ${protobusPort}...`)
		const portCheck = await checkPortAvailability(protobusPort, lockManager)

		if (!portCheck.canProceed) {
			log(`STARTUP BLOCKED: ${portCheck.error}`)
			lockManager.close()
			process.exit(1)
		}

		await lockManager.registerInstance({
			corePort: protobusPort,
			hostPort: hostBridgePort,
			version: process.env.CLINE_VERSION,
			status: "starting",
		})
		log(`Registered instance in SQLite locks: ${fullAddress}`)
	} catch (err) {
		log(`CRITICAL ERROR: Failed to register instance in SQLite locks: ${String(err)}`)
		log(`This is a fatal error - cline-core cannot start without proper instance registration`)
		if (lockManager) {
			try {
				lockManager.close()
			} catch {}
		}
		process.exit(1)
	}

	try {
		await waitForHostBridgeReady()
		log("HostBridge is serving; continuing startup")
	} catch (err) {
		log(`ERROR: HostBridge error: ${String(err)}`)
		// Cleanup lock manager entry if startup fails
		if (lockManager) {
			try {
				lockManager.unregisterInstance()
				lockManager.close()
			} catch {}
		}
		process.exit(1)
	}

	// Create extension context with the configured directory
	const extensionContext = createExtensionContext(clineDir)

	// Get EXTENSION_DIR and DATA_DIR from the extension context for use by HostProvider
	const EXTENSION_DIR = extensionContext.extensionPath
	const DATA_DIR = extensionContext.globalStoragePath

	setupHostProvider(extensionContext, EXTENSION_DIR, DATA_DIR)

	// Set up global error handlers to prevent process crashes
	setupGlobalErrorHandlers(lockManager)

	const webviewProvider = await initialize(extensionContext)

	AuthHandler.getInstance().setEnabled(true)

	startProtobusService(webviewProvider.controller)

	// Mark instance healthy after services are up
	try {
		lockManager?.touchInstance()
	} catch {}
}

function setupHostProvider(extensionContext: any, extensionDir: string, dataDir: string) {
	const createWebview = (_: WebviewProviderType): WebviewProvider => {
		return new ExternalWebviewProvider(extensionContext, WebviewProviderType.SIDEBAR)
	}
	const createDiffView = (): DiffViewProvider => {
		return new ExternalDiffViewProvider()
	}
	const getCallbackUrl = (): Promise<string> => {
		return AuthHandler.getInstance().getCallbackUrl()
	}
	// cline-core expects the binaries to be unpacked in the directory where it is running.
	const getBinaryLocation = async (name: string): Promise<string> => path.join(process.cwd(), name)

	HostProvider.initialize(
		createWebview,
		createDiffView,
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
function setupGlobalErrorHandlers(lockManager?: SqliteLockManager) {
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
		shutdownGracefully(lockManager)
	})

	process.on("SIGTERM", () => {
		log("Received SIGTERM, shutting down gracefully...")
		shutdownGracefully(lockManager)
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
			lockManager?.unregisterInstance()
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

main()
