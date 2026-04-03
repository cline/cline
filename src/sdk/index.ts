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

export {}
