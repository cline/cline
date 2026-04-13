// Replaces classic src/core/controller/index.ts (see origin/main)
//
// The Controller class is now provided by the SDK adapter layer.
// All gRPC handler modules in this directory continue to work as the
// thunking layer between the webview and the SDK.

export { Controller } from "@/sdk/SdkController"
