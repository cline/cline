import { createServiceRegistry, ServiceMethodHandler, StreamingMethodHandler } from "../grpc-service"
import { StreamingResponseHandler } from "../grpc-handler"
import { registerAllMethods } from "./methods"

// Create file service registry
const fileService = createServiceRegistry("file")

// Export the method handler types and registration function
export type FileMethodHandler = ServiceMethodHandler
export type FileStreamingMethodHandler = StreamingMethodHandler
export const registerMethod = fileService.registerMethod

// Export the request handlers
export const handleFileServiceRequest = fileService.handleRequest
export const handleStreamingRequest = fileService.handleStreamingRequest
export const isStreamingMethod = fileService.isStreamingMethod

// Register all file methods
registerAllMethods()
