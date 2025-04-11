import { BrowserConnectionInfo } from "@shared/proto/browser";
import { EmptyRequest } from "@shared/proto/common";

// Create a wrapper for the BrowserServiceService that matches the ProtoService interface
export const BrowserService = {
  serviceName: "cline.BrowserService",
  methods: {
    getBrowserConnectionInfo: {
      name: "getBrowserConnectionInfo",
      requestType: EmptyRequest,
      responseType: BrowserConnectionInfo
    }
  }
};
