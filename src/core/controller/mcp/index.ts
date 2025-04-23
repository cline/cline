import { createServiceRegistry, ServiceMethodHandler } from "../grpc-service"
import { registerAllMethods } from "./methods"

// Create MCP service registry
const mcpService = createServiceRegistry("mcp")

// Export the method handler type and registration function
export type McpMethodHandler = ServiceMethodHandler
export const registerMethod = mcpService.registerMethod

// Export the request handler
export const handleMcpServiceRequest = mcpService.handleRequest

// Register all mcp methods
registerAllMethods()
