import { GetBrowserConnectionInfoRequest, BrowserConnectionInfo } from "@shared/proto/browser";

// Create a wrapper for the BrowserServiceService that matches the ProtoService interface
export const BrowserService = {
  serviceName: "cline.BrowserService",
  methods: {
    getBrowserConnectionInfo: {
      name: "getBrowserConnectionInfo",
      requestType: GetBrowserConnectionInfoRequest,
      responseType: BrowserConnectionInfo
    }
  }
};
