import { createServiceRegistry, ServiceMethodHandler } from "../grpc-service"
import { registerAllMethods } from "./methods"

// Create browser service registry
const systemService = createServiceRegistry("system")

// Export the method handler type and registration function
export type SystemMethodHandler = ServiceMethodHandler
export const registerMethod = systemService.registerMethod

// Export the request handler
export const handleSystemServiceRequest = systemService.handleRequest

// Register all system methods
registerAllMethods()
