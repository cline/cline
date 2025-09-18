import { ExternalDiffViewProvider } from "@hosts/external/ExternalDiffviewProvider"
import { ExternalWebviewProvider } from "@hosts/external/ExternalWebviewProvider"
import { ExternalHostBridgeClientManager } from "@hosts/external/host-bridge-client-manager"
import { WebviewProviderType } from "@shared/webview/types"
import * as path from "path"
import { initialize, tearDown } from "@/common"
import { WebviewProvider } from "@/core/webview"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { HostProvider } from "@/hosts/host-provider"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import { waitForHostBridgeReady } from "./hostbridge-client"
import { startProtobusService } from "./protobus-service"
import { log } from "./utils"
import { DATA_DIR, EXTENSION_DIR, extensionContext } from "./vscode-context"

async function main() {
	log("\n\n\nStarting cline-core service...\n\n\n")

	await waitForHostBridgeReady()

	// The host bridge should be available before creating the host provider because it depends on the host bridge.
	setupHostProvider()

	// Set up global error handlers to prevent process crashes
	setupGlobalErrorHandlers()

	const webviewProvider = await initialize(extensionContext)

	// Enable the localhost HTTP server that handles auth redirects.
	AuthHandler.getInstance().setEnabled(true)

	startProtobusService(webviewProvider.controller)
}

function setupHostProvider() {
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
		EXTENSION_DIR,
		DATA_DIR,
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
