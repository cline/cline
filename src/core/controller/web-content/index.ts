import { createServiceRegistry, ServiceMethodHandler } from "../grpc-service"
import { registerAllMethods } from "./methods"

// Create web content service registry
const webContentService = createServiceRegistry("web-content")

// Export the method handler type and registration function
export type WebContentMethodHandler = ServiceMethodHandler
export const registerMethod = webContentService.registerMethod

// Export the request handler
export const handleWebContentServiceRequest = webContentService.handleRequest

// Register all web content methods
registerAllMethods()
