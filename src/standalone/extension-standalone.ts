import * as grpc from "@grpc/grpc-js"
import { ReflectionService } from "@grpc/reflection"
import * as health from "grpc-health-check"

import { activate } from "../extension"
import { Controller } from "../core/controller"
import { extensionContext, outputChannel, postMessage } from "./vscode-context"
import { packageDefinition, proto, log, camelToSnakeCase, snakeToCamelCase } from "./utils"
import { GrpcHandler, GrpcStreamingResponseHandler } from "./grpc-types"
import { addServices } from "./server-setup"
import { StreamingResponseHandler } from "@/core/controller/grpc-handler"

function main() {
	log("Starting service...")

	activate(extensionContext)
	const controller = new Controller(extensionContext, outputChannel, postMessage)
	const server = new grpc.Server()

	// Set up health check.
	const healthImpl = new health.HealthImplementation({ "": "SERVING" })
	healthImpl.addToServer(server)

	// Add all the handlers for the ProtoBus services to the server.
	addServices(server, proto, controller, wrapHandler, wrapStreamingResponseHandler)

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
			log(`gRPC request: ${call.getPath()}`)
			const result = await handler(controller, snakeToCamelCase(call.request))
			// The grpc-js serializer expects the proto message to be in the same
			// case as the proto file. This is a work around until we find a solution.
			callback(null, camelToSnakeCase(result))
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
					// The grpc-js serializer expects the proto message to be in the same
					// case as the proto file. This is a work around until we find a solution.
					call.write(camelToSnakeCase(response)) // Use a bound version of call.write to maintain proper 'this' context

					if (isLast === true) {
						log(`Closing stream for ${requestId}`)
						call.end()
					}
					return Promise.resolve()
				} catch (error) {
					return Promise.reject(error)
				}
			}
			await handler(controller, snakeToCamelCase(call.request), responseHandler, requestId)
		} catch (err: any) {
			log(`gRPC handler error: ${call.getPath()}\n${err.stack}`)
			call.destroy({
				code: grpc.status.INTERNAL,
				message: err.message || "Internal error",
			} as grpc.ServiceError)
		}
	}
}

main()
