import { getBrowserConnectionInfo } from "./getBrowserConnectionInfo";
import { Controller } from "../index";

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
  switch (method) {
    case "getBrowserConnectionInfo":
      return getBrowserConnectionInfo(controller, message);
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}
