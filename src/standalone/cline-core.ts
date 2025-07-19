import { activate } from "@/extension"
import { Controller } from "@core/controller"
import { ExternalDiffViewProvider } from "@hosts/external/ExternalDiffviewProvider"
import { ExternalWebviewProvider } from "@hosts/external/ExternalWebviewProvider"
import { ExternalHostBridgeClientManager } from "@hosts/external/host-bridge-client-manager"
import * as hostProviders from "@hosts/host-providers"
import { WebviewProviderType } from "@shared/webview/types"
import { v4 as uuidv4 } from "uuid"
import { log } from "./utils"
import { extensionContext, outputChannel, postMessage } from "./vscode-context"
import { startProtobusService } from "./protobus-service"

async function main() {
	log("\n\n\nStarting cline-core service...\n\n\n")

	// Set up global error handlers to prevent process crashes
	setupGlobalErrorHandlers()

	hostProviders.initializeHostProviders(createWebview, createDiffView, new ExternalHostBridgeClientManager())
	activate(extensionContext)
	const controller = new Controller(extensionContext, outputChannel, postMessage, uuidv4())
	startProtobusService(controller)
}

function createWebview() {
	return new ExternalWebviewProvider(extensionContext, outputChannel, WebviewProviderType.SIDEBAR)
}
function createDiffView() {
	return new ExternalDiffViewProvider()
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
		process.exit(0)
	})
}

main()
