/**
 * SDK Adapter Layer
 *
 * This module bridges the Cline SDK (@clinebot/core, @clinebot/agents,
 * @clinebot/llms, @clinebot/shared) with the existing VSCode extension
 * webview and host infrastructure.
 *
 * Modules:
 * - disk-state-adapter: Reads existing ~/.cline/data/ files
 * - provider-migration: Migrates provider credentials to SDK format
 * - message-translator: SDK session events → ClineMessage[]
 * - state-builder: Controller state → ExtensionState for webview
 * - grpc-handler: gRPC compat layer for existing webview protocol
 * - event-bridge: SDK events → webview push notifications
 * - telemetry-adapter: Extension telemetry → SDK telemetry
 * - approval-adapter: Auto-approve settings → SDK tool policies
 */

export type { DiskGlobalState, DiskSecrets, DiskStateAdapterOptions } from "./disk-state-adapter"
export { DiskStateAdapter } from "./disk-state-adapter"
export type { SdkExtensionContext, SdkExtensionOptions } from "./extension-sdk"
export { activateSdkExtension, deactivateSdkExtension } from "./extension-sdk"
export type { GrpcHandlerDelegate, GrpcRequest, GrpcResponse } from "./grpc-handler"
export { GrpcHandler } from "./grpc-handler"
export type { AgentEvent, MessageUpdate } from "./message-translator"
export { MessageTranslator } from "./message-translator"
export type { ProviderMigrationOptions, ProviderMigrationResult } from "./provider-migration"
export { clearMigrationSentinel, runProviderMigration } from "./provider-migration"
export type { SdkControllerOptions, SdkSession, SessionFactory } from "./SdkController"
export { SdkController } from "./SdkController"
export type { StateBuilderInput } from "./state-builder"
export { buildExtensionState, REQUIRED_STATE_FIELDS } from "./state-builder"
