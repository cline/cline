import { Controller } from "../index";
import { registerAllBrowserMethods } from "./methods";

// Define the type for method handlers
export type BrowserMethodHandler = (controller: Controller, message: any) => Promise<any>;

// Registry to store all browser service methods
const methodRegistry: Record<string, BrowserMethodHandler> = {};

/**
 * Register a browser service method
 * @param methodName The name of the method to register
 * @param handler The handler function for the method
 */
export function registerBrowserMethod(methodName: string, handler: BrowserMethodHandler): void {
  methodRegistry[methodName] = handler;
  console.log(`Registered browser method: ${methodName}`);
}

// Register all browser methods
registerAllBrowserMethods();

/**
 * Handle BrowserService requests
 * @param controller The controller instance
 * @param method The method name
 * @param message The request message
 * @returns The response message
 */
export async function handleBrowserServiceRequest(
  controller: Controller, 
  method: string, 
  message: any
): Promise<any> {
  const handler = methodRegistry[method];
  
  if (!handler) {
    throw new Error(`Unknown method: ${method}`);
  }
  
  return handler(controller, message);
}
