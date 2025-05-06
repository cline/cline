import { createServiceRegistry, ServiceMethodHandler } from "../grpc-service"
import { registerAllMethods } from "./methods"

// Create task service registry
const taskService = createServiceRegistry("task")

// Export the method handler type and registration function
export type TaskMethodHandler = ServiceMethodHandler
export const registerMethod = taskService.registerMethod

// Export the request handler
export const handleTaskServiceRequest = taskService.handleRequest

// Register all task methods
registerAllMethods()
