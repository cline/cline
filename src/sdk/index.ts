// SDK Adapter Layer
// Replaces classic src/core/controller/ (see origin/main)
//
// This module provides the SDK-backed Controller and related adapters.
// The webview continues to communicate via gRPC; this layer translates
// between gRPC handlers and SDK calls.

export * from "./cline-session-factory"
export * from "./legacy-state-reader"
export * from "./message-translator"
export * from "./provider-migration"
export type { SessionEventListener } from "./SdkController"
export { Controller } from "./SdkController"
export * from "./task-proxy"
export * from "./webview-grpc-bridge"
