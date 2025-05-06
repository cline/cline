import { createServiceRegistry, ServiceMethodHandler } from "../grpc-service"
import { registerAllMethods } from "./methods"

// Create file service registry
const fileService = createServiceRegistry("file")

// Export the method handler type and registration function
export type FileMethodHandler = ServiceMethodHandler
export const registerMethod = fileService.registerMethod

// Export the request handler
export const handleFileServiceRequest = fileService.handleRequest

// Register all file methods
registerAllMethods()
