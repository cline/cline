// Simplified version of the generated protobuf code without external dependencies

export const protobufPackage = "cline";

/** Empty request message for GetBrowserConnectionInfo */
export interface GetBrowserConnectionInfoRequest {
}

/** Response message containing browser connection information */
export interface BrowserConnectionInfo {
  isConnected: boolean;
  isRemote: boolean;
  /** Optional, may be empty */
  host: string;
}

// Simplified implementation of the GetBrowserConnectionInfoRequest message
export const GetBrowserConnectionInfoRequest = {
  create: (base?: Partial<GetBrowserConnectionInfoRequest>): GetBrowserConnectionInfoRequest => {
    return { ...base };
  },
  fromJSON: (_: any): GetBrowserConnectionInfoRequest => {
    return {};
  },
  toJSON: (_: GetBrowserConnectionInfoRequest): unknown => {
    return {};
  }
};

// Simplified implementation of the BrowserConnectionInfo message
export const BrowserConnectionInfo = {
  create: (base?: Partial<BrowserConnectionInfo>): BrowserConnectionInfo => {
    return {
      isConnected: base?.isConnected ?? false,
      isRemote: base?.isRemote ?? false,
      host: base?.host ?? "",
    };
  },
  fromJSON: (object: any): BrowserConnectionInfo => {
    return {
      isConnected: object?.isConnected ?? false,
      isRemote: object?.isRemote ?? false,
      host: object?.host ?? "",
    };
  },
  toJSON: (message: BrowserConnectionInfo): unknown => {
    const obj: any = {};
    if (message.isConnected !== false) {
      obj.isConnected = message.isConnected;
    }
    if (message.isRemote !== false) {
      obj.isRemote = message.isRemote;
    }
    if (message.host !== "") {
      obj.host = message.host;
    }
    return obj;
  }
};

/** Service definition for browser-related operations */
export const BrowserServiceService = {
  /** Get information about the current browser connection */
  getBrowserConnectionInfo: {
    path: "/cline.BrowserService/GetBrowserConnectionInfo",
    requestStream: false,
    responseStream: false,
  },
};
