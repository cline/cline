import { BrowserConnectionInfo } from "../../shared/proto/browser";
import { EmptyRequest } from "../../shared/proto/common";
import { Controller } from "./index";
import { getAllExtensionState } from "../storage/state";
import { ExtensionMessage } from "../../shared/ExtensionMessage";

/**
 * Handles gRPC requests from the webview
 */
export class GrpcHandler {
  constructor(private controller: Controller) {}

  /**
   * Handle a gRPC request from the webview
   * @param service The service name
   * @param method The method name
   * @param message The request message
   * @param requestId The request ID for response correlation
   * @returns The response message or error
   */
  async handleRequest(service: string, method: string, message: any, requestId: string): Promise<{
    message?: any;
    error?: string;
    request_id: string;
  }> {
    try {
      // Handle BrowserService requests
      if (service === "cline.BrowserService") {
        return {
          message: await this.handleBrowserServiceRequest(method, message),
          request_id: requestId
        };
      }

      throw new Error(`Unknown service: ${service}`);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        request_id: requestId
      };
    }
  }

  /**
   * Handle BrowserService requests
   * @param method The method name
   * @param message The request message
   * @returns The response message
   */
  private async handleBrowserServiceRequest(method: string, message: any): Promise<any> {
    switch (method) {
      case "getBrowserConnectionInfo":
        return this.getBrowserConnectionInfo(message);
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  /**
   * Get information about the current browser connection
   * @param request The request message
   * @returns The browser connection info
   */
  private async getBrowserConnectionInfo(request: EmptyRequest): Promise<BrowserConnectionInfo> {
    try {
      // Get browser settings from extension state
      const { browserSettings } = await getAllExtensionState(this.controller.context);
      
      // Check if there's an active browser session by using the controller's handleWebviewMessage approach
      // This is similar to what's done in controller/index.ts for the "getBrowserConnectionInfo" message
      if (this.controller.task?.browserSession) {
        // Access the browser session through the controller's task property
        // Using indexer notation to access private property
        const browserSession = this.controller.task.browserSession;
        const connectionInfo = browserSession.getConnectionInfo();
        
        // Convert from BrowserSession.BrowserConnectionInfo to proto.BrowserConnectionInfo
        return {
          isConnected: connectionInfo.isConnected,
          isRemote: connectionInfo.isRemote,
          host: connectionInfo.host || "" // Ensure host is never undefined
        };
      }
      
      // Fallback to browser settings if no active browser session
      return {
        isConnected: false,
        isRemote: !!browserSettings.remoteBrowserEnabled,
        host: browserSettings.remoteBrowserHost || ""
      };
    } catch (error: unknown) {
      console.error("Error getting browser connection info:", error);
      return {
        isConnected: false,
        isRemote: false,
        host: ""
      };
    }
  }
}

/**
 * Handle a gRPC request from the webview
 * @param controller The controller instance
 * @param request The gRPC request
 */
export async function handleGrpcRequest(controller: Controller, request: {
  service: string;
  method: string;
  message: any;
  request_id: string;
}) {
  try {
    const grpcHandler = new GrpcHandler(controller);
    const response = await grpcHandler.handleRequest(
      request.service,
      request.method,
      request.message,
      request.request_id
    );
    
    // Send the response back to the webview
    await controller.postMessageToWebview({
      type: "grpc_response",
      grpc_response: response
    });
  } catch (error) {
    // Send error response
    await controller.postMessageToWebview({
      type: "grpc_response",
      grpc_response: {
        error: error instanceof Error ? error.message : String(error),
        request_id: request.request_id
      }
    });
  }
}
