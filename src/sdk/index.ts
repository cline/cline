// SDK Adapter Layer
// Replaces classic src/core/controller/ (see origin/main)
//
// This module provides the SDK-backed Controller and related adapters.
// The webview continues to communicate via gRPC; this layer translates
// between gRPC handlers and SDK calls.

export * from "./legacy-state-reader"
export { Controller } from "./SdkController"
