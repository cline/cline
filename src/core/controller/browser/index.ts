import { createServiceRegistry, ServiceMethodHandler } from "../grpc-service"
import { registerAllMethods } from "./methods"

// Create browser service registry
const browserService = createServiceRegistry("browser")

// Export the method handler type and registration function
export type BrowserMethodHandler = ServiceMethodHandler
export const registerMethod = browserService.registerMethod

// Export the request handler
export const handleBrowserServiceRequest = browserService.handleRequest

// Register all browser methods
registerAllMethods()
