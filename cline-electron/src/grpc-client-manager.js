const grpc = require("@grpc/grpc-js")
const protoLoader = require("@grpc/proto-loader")
const path = require("path")

class GrpcClientManager {
	constructor() {
		this.grpcClients = null
		this.mainWindow = null
	}

	// Helper function to convert camelCase to snake_case
	camelToSnake(str) {
		return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
	}

	// Helper function to convert object keys from camelCase to snake_case
	convertObjectKeysToSnakeCase(obj) {
		if (obj === null || obj === undefined) return obj
		if (typeof obj !== "object" || Array.isArray(obj)) return obj

		const converted = {}
		for (const [key, value] of Object.entries(obj)) {
			const snakeKey = this.camelToSnake(key)
			converted[snakeKey] = value
		}
		return converted
	}

	setMainWindow(mainWindow) {
		this.mainWindow = mainWindow
	}

	async initializeGrpcClients() {
		try {
			const packageDefinition = protoLoader.loadSync(
				[
					path.join(__dirname, "../../proto/task.proto"),
					path.join(__dirname, "../../proto/state.proto"),
					path.join(__dirname, "../../proto/ui.proto"),
					path.join(__dirname, "../../proto/file.proto"),
					path.join(__dirname, "../../proto/models.proto"),
					path.join(__dirname, "../../proto/common.proto"),
				],
				{
					keepCase: true,
					longs: String,
					enums: Number, // Use numeric enums to preserve fields
					defaults: true,
					oneofs: true,
				},
			)

			const protoDescriptor = grpc.loadPackageDefinition(packageDefinition)

			this.grpcClients = {
				stateClient: new protoDescriptor.cline.StateService("127.0.0.1:50051", grpc.credentials.createInsecure()),
				taskClient: new protoDescriptor.cline.TaskService("127.0.0.1:50051", grpc.credentials.createInsecure()),
				uiClient: new protoDescriptor.cline.UiService("127.0.0.1:50051", grpc.credentials.createInsecure()),
				fileClient: new protoDescriptor.cline.FileService("127.0.0.1:50051", grpc.credentials.createInsecure()),
				modelsClient: new protoDescriptor.cline.ModelsService("127.0.0.1:50051", grpc.credentials.createInsecure()),
			}

			console.log("✅ gRPC clients initialized")
		} catch (error) {
			console.error("❌ Failed to initialize gRPC clients:", error)
		}
	}

	// Helper function to forward requests to the real gRPC server
	forwardToGrpcServer(service, method, request_id, request, is_streaming) {
		if (!this.grpcClients) {
			console.error("❌ gRPC clients not initialized")
			if (this.mainWindow && !this.mainWindow.isDestroyed()) {
				this.mainWindow.webContents.send("grpc-response", {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: null,
						is_streaming: false,
						error: "gRPC clients not initialized",
					},
				})
			}
			return
		}

		try {
			let client = null

			// Map service to client
			if (service === "cline.StateService") {
				client = this.grpcClients.stateClient
			} else if (service === "cline.TaskService") {
				client = this.grpcClients.taskClient
			} else if (service === "cline.UiService") {
				client = this.grpcClients.uiClient
			} else if (service === "cline.FileService") {
				client = this.grpcClients.fileClient
			} else if (service === "cline.ModelsService") {
				client = this.grpcClients.modelsClient
			}

			if (!client) {
				throw new Error(`No client available for service ${service}`)
			}

			// Call the method on the client
			const grpcMethod = client[method]
			if (!grpcMethod) {
				throw new Error(`Method ${method} not found on ${service}`)
			}

			console.log(`📡 Calling ${service}.${method} with request:`, request)

			// Handle special case for updateApiConfigurationProto which needs the request structure properly constructed
			let grpcRequest = request
			if (service === "cline.ModelsService" && method === "updateApiConfigurationProto") {
				// The frontend sends { metadata, apiConfiguration }, but gRPC expects snake_case field names
				if (request && typeof request === "object" && "apiConfiguration" in request) {
					// Create a properly structured request with enum handling
					const apiConfig = { ...request.apiConfiguration }

					// Handle apiProvider enum - keep as numeric value for gRPC
					if (typeof apiConfig.apiProvider === "number") {
						// Validate the enum value is in the expected range
						if (apiConfig.apiProvider >= 0 && apiConfig.apiProvider <= 25) {
							console.log(`📡 [ENUM-FIX] Using numeric apiProvider: ${apiConfig.apiProvider}`)
						} else {
							console.warn(`📡 [ENUM-FIX] Invalid apiProvider enum value: ${apiConfig.apiProvider}`)
						}
					}

					// Convert camelCase field names to snake_case for protobuf
					const snakeCaseApiConfig = this.convertObjectKeysToSnakeCase(apiConfig)

					grpcRequest = {
						metadata: request.metadata || {},
						api_configuration: snakeCaseApiConfig, // Use snake_case to match proto definition
					}
					console.log(`📡 [FIX] Properly structured request for ${method}:`, grpcRequest)
					console.log(`📡 [FIX] API Configuration:`, grpcRequest.api_configuration)
				} else {
					console.warn(`📡 [FIX] Request structure invalid for ${method}:`, request)
				}
			}

			// Make the call
			grpcMethod.call(client, grpcRequest, (error, response) => {
				if (error) {
					console.error(`❌ gRPC call failed for ${service}.${method}:`, error)
					if (this.mainWindow && !this.mainWindow.isDestroyed()) {
						this.mainWindow.webContents.send("grpc-response", {
							type: "grpc_response",
							grpc_response: {
								request_id: request_id,
								message: null,
								is_streaming: false,
								error: error.message,
							},
						})
					}
				} else {
					// Don't log the full response for getLatestState as it's too verbose
					if (method === "getLatestState") {
						console.log(`✅ gRPC call successful for ${service}.${method}: [state response omitted]`)
					} else {
						console.log(`✅ gRPC call successful for ${service}.${method}:`, response)
					}
					if (this.mainWindow && !this.mainWindow.isDestroyed()) {
						this.mainWindow.webContents.send("grpc-response", {
							type: "grpc_response",
							grpc_response: {
								request_id: request_id,
								message: response,
								is_streaming: false,
								error: null,
							},
						})
					}
				}
			})
		} catch (error) {
			console.error(`❌ Error forwarding to gRPC server:`, error)
			if (this.mainWindow && !this.mainWindow.isDestroyed()) {
				this.mainWindow.webContents.send("grpc-response", {
					type: "grpc_response",
					grpc_response: {
						request_id: request_id,
						message: null,
						is_streaming: false,
						error: error.message,
					},
				})
			}
		}
	}

	isReady() {
		return this.grpcClients !== null
	}
}

module.exports = GrpcClientManager
