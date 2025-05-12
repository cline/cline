import * as grpc from "@grpc/grpc-js"
import { ReflectionService } from "@grpc/reflection"
import * as health from "grpc-health-check"

import { activate } from "../extension"
import { Controller } from "../core/controller"
import { extensionContext, outputChannel, postMessage } from "./vscode-impls"
import { packageDefinition, proto, log } from "./utils"
import { GrpcHandler } from "./grpc-types"
import { addServices } from "./server-setup"

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
export function wrapHandler<TRequest, TResponse>(
	handler: GrpcHandler<TRequest, TResponse>,
	controller: Controller,
): grpc.handleUnaryCall<TRequest, TResponse> {
	return async (call, callback) => {
		try {
			log(`gRPC request: ${call.getPath()}`)
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

function main() {
	log("Starting service...")

	activate(extensionContext)
	const controller = new Controller(extensionContext, outputChannel, postMessage)
	const server = new grpc.Server()

	// Set up health check.
	const healthImpl = new health.HealthImplementation({ "": "SERVING" })
	healthImpl.addToServer(server)

	// Add all the handlers for the ProtoBus services to the server.
	addServices(server, proto, wrapHandler, controller)

	// Set up reflection.
	const reflection = new ReflectionService(packageDefinition)
	reflection.addToServer(server)

	// Start the server.
	const host = "127.0.0.1:50051"
	server.bindAsync(host, grpc.ServerCredentials.createInsecure(), (err) => {
		if (err) {
			log(`Error: Failed to bind to ${host}, port may be unavailable ${err.message}`)
			process.exit(1)
		} else {
			server.start()
			log(`gRPC server listening on ${host}`)
		}
	})
}

main()
