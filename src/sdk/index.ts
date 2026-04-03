/**
 * SDK Adapter Layer
 *
 * This module bridges the Cline SDK (@clinebot/core, @clinebot/agents,
 * @clinebot/llms, @clinebot/shared) with the existing VSCode extension
 * webview and host infrastructure.
 *
 * Modules:
 * - legacy-state-reader: Reads existing ~/.cline/data/ files
 * - provider-migration: Migrates provider credentials to SDK format
 * - message-translator: SDK session events → ClineMessage[]
 * - state-builder: Controller state → ExtensionState for webview
 * - grpc-handler: gRPC compat layer for existing webview protocol
 * - event-bridge: SDK events → webview push notifications
 * - telemetry-adapter: Extension telemetry → SDK telemetry
 * - approval-adapter: Auto-approve settings → SDK tool policies
 */

export { LegacyStateReader } from "./legacy-state-reader"
export type { LegacyGlobalState, LegacySecrets, LegacyStateReaderOptions } from "./legacy-state-reader"

export { runProviderMigration, clearMigrationSentinel } from "./provider-migration"
export type { ProviderMigrationOptions, ProviderMigrationResult } from "./provider-migration"

export { MessageTranslator } from "./message-translator"
export type { AgentEvent, MessageUpdate } from "./message-translator"

export { buildExtensionState, REQUIRED_STATE_FIELDS } from "./state-builder"
export type { StateBuilderInput } from "./state-builder"

export { GrpcHandler } from "./grpc-handler"
export type { GrpcHandlerDelegate, GrpcRequest, GrpcResponse } from "./grpc-handler"

export { SdkController } from "./SdkController"
export type { SdkSession, SessionFactory, SdkControllerOptions } from "./SdkController"

export { activateSdkExtension, deactivateSdkExtension } from "./extension-sdk"
export type { SdkExtensionContext, SdkExtensionOptions } from "./extension-sdk"
