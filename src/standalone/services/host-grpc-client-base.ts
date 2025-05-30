import { v4 as uuidv4 } from "uuid"
import { hostServiceHandlers } from "../../../hosts/vscode/host-grpc-service-config"

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

	// For each method in the service
	Object.values(service.methods).forEach((method) => {
		if (method.responseStream) {
			// Streaming method implementation
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
				console.log(`[DEBUG] Streaming gRPC call to ${service.fullName}.${method.name}`, request)

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
					console.log(`[DEBUG] gRPC call to ${service.fullName}.${method.name}`, request)
					const handler = hostServiceHandlers[service.fullName]
					if (handler) {
						console.log("[DEBUG] requestHandler", methodKey, request)
						handler.requestHandler(methodKey, request)
					}
				})
			}) as any
		}
	})

	return client
}
