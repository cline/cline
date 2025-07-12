import * as grpc from "@grpc/grpc-js"
import { ReflectionService } from "@grpc/reflection"
import * as health from "grpc-health-check"
import * as hostProviders from "@hosts/host-providers"
// import { activate } from "../extension" // Removed VSCode dependency
import { Controller } from "../core/controller"
import { extensionContext, outputChannel, postMessage } from "./vscode-context"
import { getPackageDefinition, log } from "./utils"
import { Logger } from "../services/logging/Logger"
import { GrpcHandler, GrpcStreamingResponseHandler } from "./grpc-types"
import { addProtobusServices } from "@generated/standalone/server-setup"
import { addHostBridgeServices } from "@generated/standalone/host-bridge-server-setup"
import { StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { ExternalHostBridgeClientManager } from "./host-bridge-client-manager"
import { ExternalWebviewProvider } from "./ExternalWebviewProvider"
import { WebviewProviderType } from "@/shared/webview/types"
import { ElectronHostBridgeProvider } from "./electron-host-bridge-provider"
import { ElectronHostBridgeClientAdapter } from "./electron-host-bridge-adapter"
import { HostBridgeClientProvider } from "@/hosts/host-provider-types"
import { v4 as uuidv4 } from "uuid"

// Standalone activation function (without VSCode dependencies)
export function activateStandalone(postMessageOverride: (message: any) => Promise<boolean>) {
	// Set environment variable to indicate standalone mode
	process.env.CLINE_STANDALONE = "true"

	log("Activating standalone Cline...")

	// Initialize Logger with the outputChannel
	Logger.initialize(outputChannel)

	// Create the embedded host bridge provider
	const hostBridgeProvider = new ElectronHostBridgeProvider()

	// Expose the host bridge provider globally for VSCode stubs
	;(global as any).__hostBridgeProvider = hostBridgeProvider
	;(globalThis as any).__hostBridgeProvider = hostBridgeProvider
	console.log("🌉 Host bridge provider exposed globally for VSCode API integration")

	// Create adapter to convert to client provider interface
	const clientAdapter = new ElectronHostBridgeClientAdapter(hostBridgeProvider)

	// Initialize host providers for standalone with embedded provider
	hostProviders.initializeHostProviders(createWebview, clientAdapter)

	// Create controller for standalone, using the provided postMessage function
	const controller = new Controller(extensionContext, outputChannel, postMessageOverride, uuidv4())

	return { controller, hostBridgeProvider }
}

export function startProtobusService(controller: Controller, hostBridgeProvider: ElectronHostBridgeProvider) {
	const server = new grpc.Server()

	// Set up health check.
	const healthImpl = new health.HealthImplementation({ "": "SERVING" })
	healthImpl.addToServer(server)

	// Add all the handlers for the ProtoBus services to the server.
	addProtobusServices(server, controller, wrapHandler as any, wrapStreamingResponseHandler as any)

	// Add host bridge services to the server using the same provider instance.
	addHostBridgeServices(server, hostBridgeProvider, wrapHostBridgeHandler as any, wrapHostBridgeStreamingHandler as any)

	// Create reflection service with protobus service names
	const packageDefinition = getPackageDefinition()
	const reflection = new ReflectionService(packageDefinition, {
		services: getProtobusServiceNames(packageDefinition),
	})
	reflection.addToServer(server)

	// Start the server with proper error handling
	const host = process.env.PROTOBUS_ADDRESS || "127.0.0.1:50051"

	// Try to bind to the specified host
	server.bindAsync(host, grpc.ServerCredentials.createInsecure(), (err) => {
		if (err) {
			// Try alternative ports if main port is busy
			log(`Failed to bind to ${host}: ${err.message}`)
			tryAlternativePort(server, 50052)
			return
		}

		try {
			server.start()
			log(`gRPC server listening on ${host}`)
		} catch (startErr: any) {
			log(`Error starting server: ${startErr.message}`)
			process.exit(1)
		}
	})

	// Helper function to try alternative ports
	function tryAlternativePort(server: grpc.Server, port: number) {
		if (port > 50060) {
			log(`No available ports found in range 50051-50060`)
			process.exit(1)
			return
		}

		const altHost = `127.0.0.1:${port}`
		log(`Trying alternative port: ${altHost}`)

		server.bindAsync(altHost, grpc.ServerCredentials.createInsecure(), (err) => {
			if (err) {
				log(`Failed to bind to ${altHost}: ${err.message}`)
				tryAlternativePort(server, port + 1)
				return
			}

			try {
				server.start()
				log(`gRPC server listening on ${altHost}`)
			} catch (startErr: any) {
				log(`Error starting server on ${altHost}: ${startErr.message}`)
				tryAlternativePort(server, port + 1)
			}
		})
	}
}

function getProtobusServiceNames(packageDefinition: { [x: string]: any }): string[] {
	// Filter service names to include cline services and host bridge services
	const protobusServiceNames = Object.keys(packageDefinition).filter(
		(name) => name.startsWith("cline.") || name.startsWith("host.") || name.startsWith("grpc.health"),
	)
	return protobusServiceNames
}

const createWebview = () => {
	return new ExternalWebviewProvider(extensionContext, outputChannel, WebviewProviderType.SIDEBAR)
}

/**
 * Wraps a Promise-based handler function to make it compatible with gRPC's callback-based API.
 * This function converts an async handler that returns a Promise into a function that uses
 * the gRPC callback pattern.
 *
 * @template TRequest - The type of the request object
 * @template TResponse - The type of the response object
 * @param handler - The Promise-based handler function to wrap
 * @param controllerInstance - The controller instance to pass to the handler
 * @returns A gRPC-compatible callback-style handler function
 */
function wrapHandler<TRequest, TResponse>(
	handler: GrpcHandler<TRequest, TResponse>,
	controller: Controller,
): grpc.handleUnaryCall<TRequest, TResponse> {
	return async (call: grpc.ServerUnaryCall<TRequest, TResponse>, callback: grpc.sendUnaryData<TResponse>) => {
		try {
			// Only log non-state requests to reduce noise
			if (!call.getPath().includes("getLatestState")) {
				log(`gRPC request: ${call.getPath()}`)
			}

			// Add specific debugging for updateSettings
			if (call.getPath() === "/cline.StateService/updateSettings") {
				console.log("📡 [WRAP-DEBUG] Raw call.request:", call.request)
				console.log("📡 [WRAP-DEBUG] call.request type:", typeof call.request)
				console.log("📡 [WRAP-DEBUG] call.request keys:", Object.keys(call.request || {}))
				console.log("📡 [WRAP-DEBUG] call.request.telemetrySetting:", (call.request as any)?.telemetrySetting)
				console.log("📡 [WRAP-DEBUG] call.request stringified:", JSON.stringify(call.request, null, 2))
			}

			// Add specific debugging for updateApiConfigurationProto
			if (call.getPath() === "/cline.ModelsService/updateApiConfigurationProto") {
				console.log("📡 [API-DEBUG] Raw call.request:", call.request)
				console.log("📡 [API-DEBUG] call.request type:", typeof call.request)
				console.log("📡 [API-DEBUG] call.request keys:", Object.keys(call.request || {}))
				console.log("📡 [API-DEBUG] call.request.apiConfiguration:", (call.request as any)?.apiConfiguration)
				console.log("📡 [API-DEBUG] call.request stringified:", JSON.stringify(call.request, null, 2))
			}

			// Add comprehensive debugging for all ModelsService calls
			if (call.getPath().includes("ModelsService")) {
				console.log("🔥 [MODELS-DEBUG] ========== ModelsService call detected ==========")
				console.log("🔥 [MODELS-DEBUG] Path:", call.getPath())
				console.log("🔥 [MODELS-DEBUG] Request object:", call.request)
				console.log("🔥 [MODELS-DEBUG] Request type:", typeof call.request)
				console.log("🔥 [MODELS-DEBUG] Request keys:", Object.keys(call.request || {}))
				if ((call.request as any)?.apiConfiguration) {
					console.log("🔥 [MODELS-DEBUG] API Configuration found:", (call.request as any).apiConfiguration)
					console.log("🔥 [MODELS-DEBUG] geminiApiKey:", (call.request as any).apiConfiguration?.geminiApiKey)
				}
				console.log("🔥 [MODELS-DEBUG] =============================================")
			}

			const result = await handler(controller, call.request)
			callback(null, result)
		} catch (err: any) {
			log(`gRPC handler error: ${call.getPath()}\n${err.stack}`)
			callback({
				code: grpc.status.INTERNAL,
				message: err.message || "Internal error",
			} as grpc.ServiceError)
		}
	}
}

function wrapStreamingResponseHandler<TRequest, TResponse>(
	handler: GrpcStreamingResponseHandler<TRequest, TResponse>,
	controller: Controller,
): grpc.handleServerStreamingCall<TRequest, TResponse> {
	return async (call: grpc.ServerWritableStream<TRequest, TResponse>) => {
		try {
			const requestId = call.metadata.get("request-id").pop()?.toString()
			log(`gRPC streaming request: ${call.getPath()}`)

			const responseHandler: StreamingResponseHandler = (response, isLast, sequenceNumber) => {
				try {
					call.write(response) // Use a bound version of call.write to maintain proper 'this' context

					if (isLast === true) {
						log(`Closing stream for ${requestId}`)
						call.end()
					}
					return Promise.resolve()
				} catch (error) {
					return Promise.reject(error)
				}
			}
			await handler(controller, call.request, responseHandler, requestId)
		} catch (err: any) {
			log(`gRPC handler error: ${call.getPath()}\n${err.stack}`)
			call.destroy({
				code: grpc.status.INTERNAL,
				message: err.message || "Internal error",
			} as grpc.ServiceError)
		}
	}
}

/**
 * Wraps a host bridge handler function to make it compatible with gRPC's callback-based API.
 */
function wrapHostBridgeHandler<TRequest, TResponse>(
	handler: (req: TRequest) => Promise<TResponse>,
): grpc.handleUnaryCall<TRequest, TResponse> {
	return async (call: grpc.ServerUnaryCall<TRequest, TResponse>, callback: grpc.sendUnaryData<TResponse>) => {
		try {
			log(`gRPC host bridge request: ${call.getPath()}`)
			const result = await handler(call.request)
			callback(null, result)
		} catch (err: any) {
			log(`gRPC host bridge handler error: ${call.getPath()}\n${err.stack}`)
			callback({
				code: grpc.status.INTERNAL,
				message: err.message || "Internal error",
			} as grpc.ServiceError)
		}
	}
}

/**
 * Wraps a host bridge streaming handler function to make it compatible with gRPC's streaming API.
 */
function wrapHostBridgeStreamingHandler<TRequest, TResponse>(
	handler: (req: TRequest, stream: any, requestId?: string) => Promise<void>,
): grpc.handleServerStreamingCall<TRequest, TResponse> {
	return async (call: grpc.ServerWritableStream<TRequest, TResponse>) => {
		try {
			const requestId = call.metadata.get("request-id").pop()?.toString()
			log(`gRPC host bridge streaming request: ${call.getPath()}`)

			const responseHandler = (response: TResponse, isLast?: boolean) => {
				try {
					call.write(response)
					if (isLast === true) {
						log(`Closing host bridge stream for ${requestId}`)
						call.end()
					}
					return Promise.resolve()
				} catch (error) {
					return Promise.reject(error)
				}
			}
			await handler(call.request, responseHandler, requestId)
		} catch (err: any) {
			log(`gRPC host bridge handler error: ${call.getPath()}\n${err.stack}`)
			call.destroy({
				code: grpc.status.INTERNAL,
				message: err.message || "Internal error",
			} as grpc.ServiceError)
		}
	}
}

// Main function to start the standalone server
export async function main() {
	log("Starting standalone service...")

	// Activate standalone Cline with the stub postMessage function
	const { controller, hostBridgeProvider } = activateStandalone(postMessage)

	// Start the gRPC server
	startProtobusService(controller, hostBridgeProvider)

	// Keep the process alive
	process.on("SIGINT", () => {
		log("Shutting down standalone service...")
		process.exit(0)
	})

	// Keep the process alive
	process.on("SIGTERM", () => {
		log("Shutting down standalone service...")
		process.exit(0)
	})
}

// Auto-start if this is the main module
if (require.main === module) {
	main().catch((error) => {
		log("Error starting standalone service:", error)
		process.exit(1)
	})
}
