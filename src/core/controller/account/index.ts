import { createServiceRegistry, ServiceMethodHandler } from "../grpc-service"
import { registerAllMethods } from "./methods"

const accountService = createServiceRegistry("account")

// Export the method handler type and registration function
export type AccountMethodHandler = ServiceMethodHandler
export const registerMethod = accountService.registerMethod

// Export the request handler
export const handleAccountServiceRequest = accountService.handleRequest

// Register all account methods
registerAllMethods()
