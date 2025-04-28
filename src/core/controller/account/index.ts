import { createServiceRegistry, ServiceMethodHandler, StreamingMethodHandler } from "../grpc-service"
import { StreamingResponseHandler } from "../grpc-handler"
import { registerAllMethods } from "./methods"

const accountService = createServiceRegistry("account")

// Export the method handler types and registration function
export type AccountMethodHandler = ServiceMethodHandler
export type AccountStreamingMethodHandler = StreamingMethodHandler
export const registerMethod = accountService.registerMethod

// Export the request handlers
export const handleAccountServiceRequest = accountService.handleRequest
export const handleStreamingRequest = accountService.handleStreamingRequest
export const isStreamingMethod = accountService.isStreamingMethod

// Register all account methods
registerAllMethods()
