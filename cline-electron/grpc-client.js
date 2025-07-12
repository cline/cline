const grpc = require("@grpc/grpc-js")
const protoLoader = require("@grpc/proto-loader")
const path = require("path")

class ClineGrpcClient {
	constructor() {
		this.clients = {}
		this.activeStreams = new Map()
	}

	async initialize() {
		try {
			// Load the proto descriptor set
			const descriptorPath = path.join(__dirname, "proto/descriptor_set.pb")
			const packageDefinition = protoLoader.loadFileDescriptorSetFromBuffer(require("fs").readFileSync(descriptorPath))

			const proto = grpc.loadPackageDefinition(packageDefinition)

			// Create clients for each service
			this.clients.AccountService = new proto.cline.AccountService("127.0.0.1:50051", grpc.credentials.createInsecure())
			this.clients.StateService = new proto.cline.StateService("127.0.0.1:50051", grpc.credentials.createInsecure())
			this.clients.UiService = new proto.cline.UiService("127.0.0.1:50051", grpc.credentials.createInsecure())
			this.clients.ModelsService = new proto.cline.ModelsService("127.0.0.1:50051", grpc.credentials.createInsecure())
			this.clients.FileService = new proto.cline.FileService("127.0.0.1:50051", grpc.credentials.createInsecure())
			this.clients.McpService = new proto.cline.McpService("127.0.0.1:50051", grpc.credentials.createInsecure())
			this.clients.TaskService = new proto.cline.TaskService("127.0.0.1:50051", grpc.credentials.createInsecure())

			// Wait for server to be ready
			await this.waitForServer()

			console.log("gRPC clients initialized and connected")
		} catch (error) {
			console.error("Failed to initialize gRPC clients:", error)
			throw error
		}
	}

	async waitForServer() {
		const maxRetries = 30
		let retries = 0

		while (retries < maxRetries) {
			try {
				// Test connection with a simple call
				await new Promise((resolve, reject) => {
					const deadline = new Date(Date.now() + 1000) // 1 second timeout
					this.clients.StateService.waitForReady(deadline, (error) => {
						if (error) {
							reject(error)
						} else {
							resolve()
						}
					})
				})
				console.log("gRPC server is ready")
				return
			} catch (error) {
				retries++
				console.log(`Waiting for gRPC server... (${retries}/${maxRetries})`)
				await new Promise((resolve) => setTimeout(resolve, 1000))
			}
		}

		throw new Error("gRPC server did not become ready within timeout")
	}

	async handleRequest(service, method, requestData, requestId, isStreaming = false) {
		try {
			const serviceName = service.replace("cline.", "")
			const client = this.clients[serviceName]

			if (!client) {
				throw new Error(`Unknown service: ${service}`)
			}

			if (!client[method]) {
				throw new Error(`Unknown method: ${method} on service: ${service}`)
			}

			console.log(`Calling ${service}.${method} with data:`, JSON.stringify(requestData))

			// Check if client is still connected
			const isConnected = await this.checkConnection(client)
			if (!isConnected) {
				throw new Error(`gRPC client for ${service} is not connected`)
			}

			if (isStreaming) {
				// Handle streaming requests
				const stream = client[method](requestData)
				this.activeStreams.set(requestId, stream)

				return new Promise((resolve, reject) => {
					stream.on("data", (response) => {
						console.log(`Streaming response from ${service}.${method}:`, response)
						resolve(response)
					})

					stream.on("error", (error) => {
						console.error(`Stream error from ${service}.${method}:`, error)
						this.activeStreams.delete(requestId)
						reject(error)
					})

					stream.on("end", () => {
						console.log(`Stream ended for ${service}.${method}`)
						this.activeStreams.delete(requestId)
					})
				})
			} else {
				// Handle unary requests
				return new Promise((resolve, reject) => {
					client[method](requestData, (error, response) => {
						if (error) {
							console.error(`Error from ${service}.${method}:`, error)
							reject(error)
						} else {
							console.log(`Response from ${service}.${method}:`, response)
							resolve(response)
						}
					})
				})
			}
		} catch (error) {
			console.error(`Failed to handle request ${service}.${method}:`, error)
			throw error
		}
	}

	cancelStream(requestId) {
		const stream = this.activeStreams.get(requestId)
		if (stream) {
			stream.cancel()
			this.activeStreams.delete(requestId)
			console.log(`Cancelled stream for request ${requestId}`)
		}
	}

	async checkConnection(client) {
		try {
			await new Promise((resolve, reject) => {
				const deadline = new Date(Date.now() + 1000) // 1 second timeout
				client.waitForReady(deadline, (error) => {
					if (error) {
						reject(error)
					} else {
						resolve()
					}
				})
			})
			return true
		} catch (error) {
			console.error("gRPC client connection check failed:", error)
			return false
		}
	}

	close() {
		// Cancel all active streams
		for (const [requestId, stream] of this.activeStreams) {
			stream.cancel()
		}
		this.activeStreams.clear()

		// Close all clients
		for (const [serviceName, client] of Object.entries(this.clients)) {
			client.close()
		}
		this.clients = {}
	}
}

module.exports = ClineGrpcClient
