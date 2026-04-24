// SDK Adapter Layer
// Replaces classic src/core/controller/ (see origin/main)
//
// This module provides the SDK-backed Controller and related adapters.
// The webview continues to communicate via gRPC; this layer translates
// between gRPC handlers and SDK calls.

export * from "./account-service"
export * from "./auth-service"
export * from "./cline-session-factory"
export * from "./legacy-state-reader"
export * from "./message-translator"
export * from "./provider-migration"
export { Controller } from "./SdkController"
export * from "./sdk-interaction-coordinator"
export type { SessionEventListener } from "./sdk-message-coordinator"
export * from "./sdk-message-coordinator"
export * from "./sdk-mode-coordinator"
export * from "./sdk-session-config-builder"
export * from "./sdk-session-factory"
export * from "./sdk-session-lifecycle"
export * from "./sdk-task-history"
export * from "./sdk-tool-policies"
export * from "./task-proxy"
export * from "./vscode-runtime-builder"
export * from "./vscode-session-host"
export * from "./webview-grpc-bridge"
