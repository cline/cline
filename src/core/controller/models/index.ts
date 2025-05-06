import { createServiceRegistry, ServiceMethodHandler } from "../grpc-service"
import { registerAllMethods } from "./methods"

// Create models service registry
const modelsService = createServiceRegistry("models")

// Export the method handler type and registration function
export type ModelsMethodHandler = ServiceMethodHandler
export const registerMethod = modelsService.registerMethod

// Export the request handler
export const handleModelsServiceRequest = modelsService.handleRequest

// Register all models methods
registerAllMethods()
