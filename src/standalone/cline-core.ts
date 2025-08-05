import { activate } from "@/extension"
import { Controller } from "@core/controller"
import { CacheService } from "@core/storage/CacheService"
import { ExternalDiffViewProvider } from "@hosts/external/ExternalDiffviewProvider"
import { ExternalWebviewProvider } from "@hosts/external/ExternalWebviewProvider"
import { ExternalHostBridgeClientManager } from "@hosts/external/host-bridge-client-manager"
import { HostProvider } from "@/hosts/host-provider"
import { WebviewProviderType } from "@shared/webview/types"
import { v4 as uuidv4 } from "uuid"
import { log } from "./utils"
import { extensionContext, postMessage } from "./vscode-context"
import { startProtobusService } from "./protobus-service"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { WebviewProvider } from "@/core/webview"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"

async function main() {
	log("\n\n\nStarting cline-core service...\n\n\n")

	AuthHandler.getInstance().setEnabled(true)

	setupHostProvider()

	// Set up global error handlers to prevent process crashes
	setupGlobalErrorHandlers()

	activate(extensionContext)
	// Create and initialize cache service

	// Create controller with cache service
	const controller = new Controller(extensionContext, postMessage, uuidv4())
	startProtobusService(controller)
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
