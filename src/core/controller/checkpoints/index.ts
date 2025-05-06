import { createServiceRegistry, ServiceMethodHandler } from "../grpc-service"
import { registerAllMethods } from "./methods"

// Create checkpoints service registry
const checkpointsService = createServiceRegistry("checkpoints")

// Export the method handler type and registration function
export type CheckpointsMethodHandler = ServiceMethodHandler
export const registerMethod = checkpointsService.registerMethod

// Export the request handler
export const handleCheckpointsServiceRequest = checkpointsService.handleRequest

// Register all checkpoints methods
registerAllMethods()
