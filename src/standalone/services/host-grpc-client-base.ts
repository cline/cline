import { v4 as uuidv4 } from "uuid"
import { GrpcHandler, getRequestRegistry, StreamingResponseHandler } from "../../../hosts/vscode/host-grpc-handler"

// Generic type for any protobuf service definition
export type ProtoService = {
	name: string
	fullName: string
	methods: {
		[key: string]: {
			name: string
			requestType: any
			responseType: any
			requestStream: boolean
			responseStream: boolean
			options: any
		}
	}
}

// Define a unified client type that handles both unary and streaming methods
export type GrpcClientType<T extends ProtoService> = {
	[K in keyof T["methods"]]: T["methods"][K]["responseStream"] extends true
		? (
				request: InstanceType<T["methods"][K]["requestType"]>,
				options: {
					onResponse: (response: InstanceType<T["methods"][K]["responseType"]>) => void
					onError?: (error: Error) => void
					onComplete?: () => void
				},
			) => () => void // Returns a cancel function
		: (request: InstanceType<T["methods"][K]["requestType"]>) => Promise<InstanceType<T["methods"][K]["responseType"]>>
}

// Create a client for any protobuf service with inferred types
export function createGrpcClient<T extends ProtoService>(service: T): GrpcClientType<T> {
	const client = {} as GrpcClientType<T>
	const grpcHandler = new GrpcHandler()

	Object.values(service.methods).forEach((method) => {
		// Streaming method implementation
		if (method.responseStream) {
			// Use lowercase method name as the key in the client object
			const methodKey = method.name.charAt(0).toLowerCase() + method.name.slice(1)
			client[methodKey as keyof GrpcClientType<T>] = ((
				request: any,
				options: {
					onResponse: (response: any) => void
					onError?: (error: Error) => void
					onComplete?: () => void
				},
			) => {
				const requestId = uuidv4()

				// Create a response handler that will call the client's onResponse callback
				const responseHandler: StreamingResponseHandler = async (response, isLast = false, sequenceNumber) => {
					try {
						// Call the client's onResponse callback with the response
						options.onResponse(response)

						// If this is the last response, call the onComplete callback
						if (isLast && options.onComplete) {
							options.onComplete()
						}
					} catch (error) {
						// If there's an error in the callback, call the onError callback
						if (options.onError) {
							options.onError(error instanceof Error ? error : new Error(String(error)))
						}
					}
				}

				// Register the response handler with the registry
				// TODO this seems weird, I think registration is only
				// supposed to happen on the server side of gRPC
				getRequestRegistry().registerRequest(
					requestId,
					() => {
						console.log(`[DEBUG] Cleaning up streaming request: ${requestId}`)
						if (options.onComplete) {
							options.onComplete()
						}
					},
					{ type: "streaming_request", service: service.fullName, method: methodKey },
					responseHandler,
				)

				// Call the handler with streaming=true
				console.log(`[DEBUG] Streaming gRPC host call to ${service.fullName}.${methodKey} req:${requestId}`)
				grpcHandler.handleRequest(service.fullName, methodKey, request, requestId, true).catch((error) => {
					if (options.onError) {
						options.onError(error instanceof Error ? error : new Error(String(error)))
					}
				})

				// Return a function to cancel the stream
				return () => {
					console.log(`[DEBUG] Cancelling streaming request: ${requestId}`)
					getRequestRegistry().cancelRequest(requestId)
				}
			}) as any
		} else {
			// Unary method implementation
			const methodKey = method.name.charAt(0).toLowerCase() + method.name.slice(1)
			client[methodKey as keyof GrpcClientType<T>] = ((request: any) => {
				return new Promise(async (resolve, reject) => {
					const requestId = uuidv4()
					console.log(`[DEBUG] gRPC host call to ${service.fullName}.${methodKey} req:${requestId}`)
					try {
						const response = await grpcHandler.handleRequest(service.fullName, methodKey, request, requestId, false)
						console.log(`[DEBUG] gRPC host resp to ${service.fullName}.${methodKey} req:${requestId}`, response)
						console.log("[DEBUG] TODO remove response")
						if (response && response.message) {
							resolve(response.message)
						} else {
							throw new Error("gRPC response didn't have a message")
						}
					} catch (e) {
						console.log(`[DEBUG] gRPC host ERR to ${service.fullName}.${methodKey} req:${requestId} err:${e}`)
						reject(e)
					}
				})
			}) as any
		}
	})

	return client
}
