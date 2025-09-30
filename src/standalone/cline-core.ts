import { ExternalDiffViewProvider } from "@hosts/external/ExternalDiffviewProvider"
import { ExternalWebviewProvider } from "@hosts/external/ExternalWebviewProvider"
import { ExternalHostBridgeClientManager } from "@hosts/external/host-bridge-client-manager"
import * as path from "path"
import { initialize, tearDown } from "@/common"
import { WebviewProvider } from "@/core/webview"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { HostProvider } from "@/hosts/host-provider"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import { HOSTBRIDGE_PORT, waitForHostBridgeReady } from "./hostbridge-client"
import { PROTOBUS_PORT, startProtobusService } from "./protobus-service"
import { log } from "./utils"
import { initializeContext } from "./vscode-context"

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
  HOSTBRIDGE_ADDRESS            Override the host bridge address (format: host:port)
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

	// Initialize context with optional custom directory from CLI
	const { extensionContext, DATA_DIR, EXTENSION_DIR } = initializeContext(args.config)

	// Configure ports - CLI args override everything
	if (args.port) {
		process.env.PROTOBUS_ADDRESS = `127.0.0.1:${args.port}`
		// Auto-calculate hostbridge port if not specified
		if (!args.hostBridgePort) {
			process.env.HOST_BRIDGE_ADDRESS = `localhost:${args.port + 1000}`
		}
	}
	if (args.hostBridgePort) {
		process.env.HOST_BRIDGE_ADDRESS = `localhost:${args.hostBridgePort}`
	}

	log("\n\n\nStarting cline-core service...\n\n\n")

	await waitForHostBridgeReady()

	// The host bridge should be available before creating the host provider because it depends on the host bridge.
	setupHostProvider(extensionContext, EXTENSION_DIR, DATA_DIR)

	// Set up global error handlers to prevent process crashes
	setupGlobalErrorHandlers()

	const webviewProvider = await initialize(extensionContext)

	// Enable the localhost HTTP server that handles auth redirects.
	AuthHandler.getInstance().setEnabled(true)

	startProtobusService(webviewProvider.controller)
}

function setupHostProvider(extensionContext: any, extensionDir: string, dataDir: string) {
	const createWebview = (): WebviewProvider => {
		return new ExternalWebviewProvider(extensionContext)
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
		process.exit(0)
	})

	process.on("SIGTERM", () => {
		log("Received SIGTERM, shutting down gracefully...")
		tearDown()

		process.exit(0)
	})
}

main()
