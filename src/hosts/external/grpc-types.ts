import { Controller } from "@core/controller"
import * as grpc from "@grpc/grpc-js"
import { Channel, createChannel } from "nice-grpc"

/**
 * Type definition for a gRPC handler function.
 * This represents a function that takes a Controller instance and a request object,
 * and returns a Promise of the response type.
 *
 * @template TRequest - The type of the request object
 * @template TResponse - The type of the response object
 */
export type GrpcHandler<TRequest, TResponse> = (controller: Controller, req: TRequest) => Promise<TResponse>

export type GrpcStreamingResponseHandler<TRequest, TResponse> = (
	controller: Controller,
	req: TRequest,
	streamResponseHandler: StreamingResponseWriter<TResponse>,
	requestId?: string,
) => Promise<void>

/**
 * Type definition for the wrapper function that converts a Promise-based handler
 * to a gRPC callback-style handler.
 *
 * @template TRequest - The type of the request object
 * @template TResponse - The type of the response object
 */
export type GrpcHandlerWrapper = <TRequest, TResponse>(
	handler: GrpcHandler<TRequest, TResponse>,
	controller: Controller,
) => grpc.handleUnaryCall<TRequest, TResponse>

export type GrpcStreamingResponseHandlerWrapper = <TRequest, TResponse>(
	handler: GrpcStreamingResponseHandler<TRequest, TResponse>,
	controller: Controller,
) => grpc.handleServerStreamingCall<TRequest, TResponse>

export type StreamingResponseWriter<TResponse> = (response: TResponse, isLast?: boolean, sequenceNumber?: number) => Promise<void>

/**
 * Abstract base class for type-safe gRPC client implementations.
 *
 * Provides automatic connection management with lazy initialization and
 * transparent reconnection on network failures. Ensures type safety through
 * generic client typing and consistent error handling patterns.
 *
 * @template TClient - The specific gRPC client type (e.g., niceGrpc.host.DiffServiceClient)
 */
export abstract class BaseGrpcClient<TClient> {
	private client: TClient | null = null
	private channel: Channel | null = null
	protected address: string

	constructor(address: string) {
		this.address = address
	}

	protected abstract createClient(channel: Channel): TClient

	protected getClient(): TClient {
		if (!this.client || !this.channel) {
			this.channel = createChannel(this.address)
			this.client = this.createClient(this.channel)
		}
		return this.client
	}

	protected destroyClient(): void {
		this.channel?.close()
		this.client = null
		this.channel = null
	}

	protected async makeRequest<T>(requestFn: (client: TClient) => Promise<T>): Promise<T> {
		const client = this.getClient()

		try {
			return await requestFn(client)
		} catch (error: any) {
			if (error?.code === "UNAVAILABLE") {
				this.destroyClient()
			}
			throw error
		}
	}
}
