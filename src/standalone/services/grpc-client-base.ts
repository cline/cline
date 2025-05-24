import { v4 as uuidv4 } from "uuid"

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

/**
 * Helper function to encode request objects
 */
function encodeRequest(request: any): any {
	if (request === null || request === undefined) {
		return {}
	} else if (typeof request.toJSON === "function") {
		return request.toJSON()
	} else if (typeof request === "object") {
		return { ...request }
	} else {
		return { value: request }
	}
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
				console.log(`[DEBUG] Would make streaming gRPC call to ${service.fullName}.${method.name}`, request)
				
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
			// Use lowercase method name as the key in the client object
			const methodKey = method.name.charAt(0).toLowerCase() + method.name.slice(1)
			client[methodKey as keyof GrpcClientType<T>] = ((request: any) => {
				return new Promise((resolve, reject) => {
					// TODO: Implement actual gRPC call to the IDE host
					console.log(`[DEBUG] Would make gRPC call to ${service.fullName}.${method.name}`, request)
					
					// For now, just simulate a response based on the method
					const methodKey = method.name.charAt(0).toLowerCase() + method.name.slice(1)
					if (methodKey === "parse") {
						// For Uri.parse, return a simulated Uri object
						const uri = request.uri || ""
						const scheme = uri.startsWith("file:") ? "file" : "https"
						const path = uri.replace(/^file:\/\//, "").replace(/^https:\/\/[^/]+/, "")
						
						setTimeout(() => {
							resolve({
								scheme,
								authority: uri.includes("://") ? uri.split("://")[1].split("/")[0] : "",
								path,
								query: "",
								fragment: "",
								fsPath: path
							})
						}, 100)
					} else if (methodKey === "file") {
						// For Uri.file, return a simulated Uri object
						setTimeout(() => {
							resolve({
								scheme: "file",
								authority: "",
								path: request.path || "",
								query: "",
								fragment: "",
								fsPath: request.path || ""
							})
						}, 100)
					} else if (methodKey === "joinPath") {
						// For Uri.joinPath, return a simulated Uri object
						const base = request.base || { scheme: "file", authority: "", path: "/" }
						const segments = request.pathSegments || []
						const joinedPath = [base.path, ...segments].join("/").replace(/\/+/g, "/")
						
						setTimeout(() => {
							resolve({
								scheme: base.scheme,
								authority: base.authority,
								path: joinedPath,
								query: "",
								fragment: "",
								fsPath: joinedPath
							})
						}, 100)
					} else {
						// Generic fallback
						setTimeout(() => {
							const methodKey = method.name.charAt(0).toLowerCase() + method.name.slice(1)
							reject(new Error(`Method ${methodKey} not implemented in standalone client`))
						}, 100)
					}
				})
			}) as any
		}
	})

	return client
}
