import { v4 as uuidv4 } from "uuid"
import { GrpcHandler } from "../../../hosts/vscode/host-grpc-handler"

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

				// TODO: Implement actual gRPC streaming call to the IDE host
				console.log(`[DEBUG] Streaming gRPC call to ${service.fullName}.${methodKey}`, request)
				console.log("[DEBUG] TODO Streaming responses from host not implemented")

				// For now, just simulate a response
				setTimeout(() => {
					if (options.onComplete) {
						options.onComplete()
					}
				}, 100)

				// Return a function to cancel the stream
				return () => {
					console.log(`[DEBUG] Would cancel streaming request: ${requestId}`)
				}
			}) as any
		} else {
			// Unary method implementation
			const methodKey = method.name.charAt(0).toLowerCase() + method.name.slice(1)
			client[methodKey as keyof GrpcClientType<T>] = ((request: any) => {
				return new Promise((resolve, reject) => {
					const requestId = uuidv4()
					console.log(`[DEBUG] gRPC host call to ${service.fullName}.${methodKey} req:${requestId}`)
					try {
						const response = grpcHandler.handleRequest(service.fullName, methodKey, request, requestId, false)
						console.log(`[DEBUG] gRPC host resp to ${service.fullName}.${methodKey} req:${requestId}`, response)
						console.log("[DEBUG] TODO remove response")
						resolve(response)
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
