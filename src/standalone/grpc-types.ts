import * as grpc from "@grpc/grpc-js"
import { Controller } from "../core/controller"

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
) => Promise<TResponse>

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
