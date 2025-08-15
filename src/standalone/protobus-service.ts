import { Controller } from "@core/controller"
import { StreamingResponseHandler } from "@core/controller/grpc-handler"
import { addProtobusServices } from "@generated/hosts/standalone/protobus-server-setup"
import * as grpc from "@grpc/grpc-js"
import { ReflectionService } from "@grpc/reflection"
import { GrpcHandler, GrpcStreamingResponseHandler } from "@hosts/external/grpc-types"
import * as health from "grpc-health-check"
import { getPackageDefinition, log } from "./utils"
import * as protoLoader from "@grpc/proto-loader"

export const PROTOBUS_PORT = 26040
export const HOSTBRIDGE_PORT = 26041

export function startProtobusService(controller: Controller) {
	const server = new grpc.Server()

	// Set up health check.
	const healthImpl = new health.HealthImplementation({ "": "SERVING" })
	healthImpl.addToServer(server)

	// Add all the handlers for the ProtoBus services to the server.
	addProtobusServices(server, controller, wrapHandler, wrapStreamingResponseHandler)

	// Create reflection service with protobus service names
	const packageDefinition = getPackageDefinition()
	const reflection = new ReflectionService(packageDefinition, {
		services: getProtobusServiceNames(packageDefinition),
	})
	reflection.addToServer(server)

	// Start the server.
	const host = process.env.PROTOBUS_ADDRESS || `127.0.0.1:${PROTOBUS_PORT}`
	server.bindAsync(host, grpc.ServerCredentials.createInsecure(), (err) => {
		if (err) {
			log(`Could not start ProtoBus service: Failed to bind to ${host}, port may be unavailable. ${err.message}`)
			process.exit(1)
		}
		server.start()
		log(`ProtoBus gRPC server listening on ${host}`)
	})
}

function getProtobusServiceNames(packageDefinition: { [x: string]: any }): string[] {
	// Filter service names to only include cline services
	const protobusServiceNames = Object.keys(packageDefinition).filter(
		(name) => name.startsWith("cline.") || name.startsWith("grpc.health"),
	)
	return protobusServiceNames
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
			log(`ProtoBus request: ${call.getPath()}`)
			const result = await handler(controller, call.request)
			callback(null, result)
		} catch (err: any) {
			log(`ProtoBus handler error: ${call.getPath()}\n${err.stack}`)
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
			log(`ProtoBus gRPC streaming request: ${call.getPath()}`)

			const responseHandler: StreamingResponseHandler<TResponse> = (response, isLast, sequenceNumber) => {
				try {
					call.write(response) // Use a bound version of call.write to maintain proper 'this' context

					if (isLast === true) {
						log(`Closing ProtoBus stream for ${requestId}`)
						call.end()
					}
					return Promise.resolve()
				} catch (error) {
					return Promise.reject(error)
				}
			}
			await handler(controller, call.request, responseHandler, requestId)
		} catch (err: any) {
			log(`ProtoBus handler error: ${call.getPath()}\n${err.stack}`)
			call.destroy({
				code: grpc.status.INTERNAL,
				message: err.message || "Internal error",
			} as grpc.ServiceError)
		}
	}
}

// Client-side health check for the hostbridge service (kept at bottom for clarity)
const SERVING_STATUS = 1
function createHealthClient(address?: string) {
	const healthDef = protoLoader.loadSync(health.protoPath)
	const grpcObj = grpc.loadPackageDefinition(healthDef) as unknown as any
	const Health = grpcObj.grpc.health.v1.Health
	const target = address || process.env.HOST_BRIDGE_ADDRESS || `localhost:${HOSTBRIDGE_PORT}`
	return new Health(target, grpc.credentials.createInsecure())
}

async function checkHealthOnce(client: any): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		client.check({ service: "" }, (err: unknown, resp: any) => {
			if (err) {
				return resolve(false)
			}
			return resolve(resp?.status === SERVING_STATUS)
		})
	})
}

export async function waitForHostBridgeReady(timeoutMs = 60000, intervalMs = 500, address?: string): Promise<void> {
	const client = createHealthClient(address)
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		// eslint-disable-next-line no-await-in-loop
		const ok = await checkHealthOnce(client)
		if (ok) {
			try {
				client.close?.()
			} catch {}
			return
		}
		log("Waiting for hostbridge to be ready...")
		// eslint-disable-next-line no-await-in-loop
		await new Promise((r) => setTimeout(r, intervalMs))
	}
	try {
		client.close?.()
	} catch {}
	throw new Error("HostBridge health check timed out")
}
