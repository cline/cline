import { ExternalDiffViewProvider } from "@hosts/external/ExternalDiffviewProvider"
import { ExternalWebviewProvider } from "@hosts/external/ExternalWebviewProvider"
import { ExternalHostBridgeClientManager } from "@hosts/external/host-bridge-client-manager"
import { WebviewProviderType } from "@shared/webview/types"
import os from "os"
import { initialize, tearDown } from "@/common"
import { InstanceRegistry } from "@/core/registry/InstanceRegistry"
import { WebviewProvider } from "@/core/webview"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { HostProvider } from "@/hosts/host-provider"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import { startProtobusService, waitForHostBridgeReady } from "./protobus-service"
import { log } from "./utils"
import { extensionContext } from "./vscode-context"

// Default ports
export const DEFAULT_PROTOBUS_PORT = 26040
export const DEFAULT_HOSTBRIDGE_PORT = 26041

// Parse command line arguments
interface CliArgs {
	port?: number
	hostBridgePort?: number
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
  -h, --help                     Show this help message

Environment Variables:
  PROTOBUS_ADDRESS              Override the main service address (format: host:port)
  HOSTBRIDGE_ADDRESS            Override the host bridge address (format: host:port)
  CLINE_DIR                     Directory for Cline data storage
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

	// Configure ports from arguments
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
		process.env.PROTOBUS_ADDRESS = `127.0.0.1:${protobusPort}`
	}
	if (!process.env.HOSTBRIDGE_ADDRESS) {
		process.env.HOSTBRIDGE_ADDRESS = `127.0.0.1:${hostBridgePort}`
	}

	log("\n\n\nStarting cline-core service...\n\n\n")
	log(`Using Protobus port: ${protobusPort}`)
	log(`Using Host Bridge port: ${hostBridgePort}`)

	// Initialize instance registry (per-instance file in ~/.cline/registry)
	const clineDir = process.env.CLINE_DIR || `${os.homedir()}/.cline`
	// Use host:port everywhere (no scheme)
	const fullAddress = `localhost:${protobusPort}`
	let registry: InstanceRegistry | undefined
	try {
		registry = new InstanceRegistry(clineDir, fullAddress)
		await registry.register({
			corePort: protobusPort,
			hostPort: hostBridgePort,
			version: process.env.CLINE_VERSION,
			status: "starting",
		})
		log(`Registered instance in registry: ${fullAddress}`)
	} catch (err) {
		log(`ERROR: Failed to register instance in registry: ${String(err)}`)
	}

	try {
		await waitForHostBridgeReady()
		log("HostBridge is serving; continuing startup")
	} catch (err) {
		log(`ERROR: HostBridge error: ${String(err)}`)
		// Cleanup registry entry if startup fails
		if (registry) {
			try {
				await registry.unregister()
			} catch {}
		}
		process.exit(1)
	}

	setupHostProvider()

	// Set up global error handlers to prevent process crashes
	setupGlobalErrorHandlers(registry)

	const webviewProvider = await initialize(extensionContext)

	AuthHandler.getInstance().setEnabled(true)

	startProtobusService(webviewProvider.controller)

	// Mark instance healthy after services are up
	try {
		await registry?.updateStatus("healthy")
	} catch {}
}

function setupHostProvider() {
	const createWebview = (_: WebviewProviderType): WebviewProvider => {
		return new ExternalWebviewProvider(extensionContext, WebviewProviderType.SIDEBAR)
	}
	const createDiffView = (): DiffViewProvider => {
		return new ExternalDiffViewProvider()
	}
	const getCallbackUri = (): Promise<string> => {
		return AuthHandler.getInstance().getCallbackUri()
	}

	HostProvider.initialize(createWebview, createDiffView, new ExternalHostBridgeClientManager(), log, getCallbackUri)
}

/**
 * Sets up global error handlers to prevent the process from crashing
 * on unhandled exceptions and promise rejections
 */
function setupGlobalErrorHandlers(registry?: InstanceRegistry) {
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
		shutdownGracefully(registry)
	})

	process.on("SIGTERM", () => {
		log("Received SIGTERM, shutting down gracefully...")
		shutdownGracefully(registry)
	})
}

/**
 * Request host bridge shutdown with retry logic and timeout handling.
 * Uses best-effort approach - logs failures but doesn't block shutdown.
 */
async function requestHostBridgeShutdown(): Promise<void> {
	const maxRetries = 3
	const timeoutMs = 2000 // Short timeout since we're shutting down

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			// Create a timeout promise
			const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))

			// Race the shutdown call against timeout
			await Promise.race([HostProvider.env.shutdown({}), timeoutPromise])

			log("Host bridge shutdown requested successfully")
			return // Success - exit early
		} catch (error) {
			log(`Shutdown attempt ${attempt}/${maxRetries} failed: ${error}`)

			if (attempt < maxRetries) {
				// Brief delay before retry (but not too long since we're shutting down)
				await new Promise((resolve) => setTimeout(resolve, 500))
			}
		}
	}

	log("Warning: Failed to request host bridge shutdown after all retries - proceeding with cleanup")
}

/**
 * Gracefully shutdown the cline-core process by:
 * 1. Calling shutdown RPC on the paired host bridge
 * 2. Cleaning up the registry entry
 * 3. Tearing down services
 * 4. Exiting the process
 */
async function shutdownGracefully(registry?: InstanceRegistry) {
	try {
		// Step 1: Tell the paired host bridge to shut down
		log("Requesting host bridge shutdown...")
		if (HostProvider.isInitialized()) {
			await requestHostBridgeShutdown()
		} else {
			log("Warning: HostProvider not initialized, cannot request shutdown")
		}

		// Step 2: Clean up registry entry
		log("Cleaning up registry entry...")
		try {
			await registry?.unregister()
			log("Registry entry cleaned up successfully")
		} catch (error) {
			log(`Warning: Failed to clean up registry: ${error}`)
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
