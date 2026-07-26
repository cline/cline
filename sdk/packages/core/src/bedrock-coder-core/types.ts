import type { Message } from "@bedrock-coder/llms";
import type { AgentConfig, BasicLogger } from "@bedrock-coder/shared";
import type { CheckpointEntry } from "../hooks/checkpoint-hooks";
import type { RuntimeCapabilities } from "../runtime/capabilities";
import type { SessionHistoryListOptions } from "../runtime/host/history";
import type { SessionBackend } from "../runtime/host/host";
import type {
	LocalRuntimeStartOptions,
	RuntimeHostMode,
	StartSessionInput,
	StartSessionResult,
} from "../runtime/host/runtime-host";
import type { CheckpointWorkspaceCompareResult } from "../session/checkpoint-diff";
import type { BedrockCoderCoreStartConfig } from "../types/config";
import type { SessionMessagesArtifactUploader } from "../types/session";

export type { RuntimeHostMode } from "../runtime/host/runtime-host";
export type { BedrockCoderCoreSettingsApi } from "../settings";

export interface HubOptions {
	endpoint?: string;
	authToken?: string;
	strategy?: "prefer-hub" | "require-hub";
	clientType?: string;
	displayName?: string;
	workspaceRoot?: string;
	cwd?: string;
}

export interface RemoteOptions {
	endpoint: string;
	authToken?: string;
	clientType?: string;
	displayName?: string;
	workspaceRoot?: string;
	cwd?: string;
}

export type BedrockCoderCoreListHistoryOptions = SessionHistoryListOptions;

export interface BedrockCoderCoreStartInput
	extends Omit<StartSessionInput, "config" | "localRuntime"> {
	config: BedrockCoderCoreStartConfig;
	localRuntime?: LocalRuntimeStartOptions;
}

export interface RestoreOptions {
	/**
	 * Restore the message history by starting a new session fork trimmed to
	 * `checkpointRunCount`. Defaults to true.
	 */
	messages?: boolean;
	/**
	 * Restore the workspace files from the checkpoint's git snapshot.
	 * Defaults to true.
	 */
	workspace?: boolean;
	/**
	 * Must be true when `workspace` is true. Hosts should set this only after
	 * showing the compare plan and receiving an explicit user action.
	 */
	workspaceApproved?: boolean;
	/**
	 * Start the forked session with messages before the checkpoint user message
	 * while still returning messages through that user message. This is for
	 * clients that put the checkpoint message back into a compose box so it can
	 * be edited and submitted again without duplicating it in session history.
	 */
	omitCheckpointMessageFromSession?: boolean;
}

export interface RestoreInput {
	sessionId: string;
	checkpointRunCount: number;
	start?: BedrockCoderCoreStartInput;
	cwd?: string;
	restore?: RestoreOptions;
}

export interface RestoreResult {
	sessionId?: string;
	startResult?: StartSessionResult;
	messages?: Message[];
	checkpoint: CheckpointEntry;
}

export interface CompareCheckpointInput {
	sessionId: string;
	checkpointRunCount: number;
	cwd?: string;
}

export type CompareCheckpointResult = CheckpointWorkspaceCompareResult;

export interface BedrockCoderCoreOptions {
	/**
	 * A human-readable name for this SDK client (e.g. `"my-app"`, `"acme-bot"`).
	 * Used to identify the consumer in local logs.
	 */
	clientName?: string;
	/**
	 * Controls how the runtime host is selected:
	 * - `"auto"` (default) — prefers a compatible local hub when one is available and falls
	 *   back to local in-process execution when not.
	 * - `"hub"` — requires a compatible websocket hub runtime; throws if one is not reachable.
	 * - `"remote"` — requires an explicit remote websocket hub endpoint.
	 * - `"local"` — always uses local in-process execution and local SQLite/file storage.
	 */
	backendMode?: RuntimeHostMode;
	/**
	 * Hub runtime connection options. Used when `backendMode` is `"hub"` or when `"auto"`
	 * should prefer a shared local hub if available.
	 */
	hub?: HubOptions;
	/**
	 * Remote hub connection options. Only relevant when `backendMode` is `"remote"`.
	 */
	remote?: RemoteOptions;
	/**
	 * Client-owned runtime capabilities. Core adapts these handlers to the
	 * selected runtime backend so apps implement interactive behavior once.
	 */
	capabilities?: RuntimeCapabilities;
	/**
	 * Optional structured logger for core-side operational diagnostics such as
	 * runtime-host selection and fallback decisions.
	 */
	logger?: BasicLogger;
	/**
	 * Per-tool approval policies that control whether a tool runs automatically,
	 * requires user confirmation, or is blocked entirely.
	 */
	toolPolicies?: AgentConfig["toolPolicies"];
	/**
	 * Optional hook invoked after `messages.json` is persisted to disk.
	 * Consumers can use this to mirror session transcripts into remote storage.
	 */
	messagesArtifactUploader?: SessionMessagesArtifactUploader;
	/**
	 * An already-constructed session backend to use instead of resolving one automatically.
	 * Intended for testing or embedding a custom persistence layer.
	 * @internal
	 */
	sessionService?: SessionBackend;
	/**
	 * Optional hook invoked before each session starts.
	 * Use this to prepare workspace-scoped runtime state and then return an
	 * adapter that mutates the shared session input before core starts the run.
	 * This runs before the execution host resolves an omitted workspace, so
	 * pathless starts expose neither `cwd` nor `workspaceRoot` to this hook.
	 */
	prepare?: (
		input: BedrockCoderCoreStartInput,
	) =>
		| Promise<StartSessionBootstrap | undefined>
		| StartSessionBootstrap
		| undefined;
}

export interface StartSessionBootstrap {
	applyToStartSessionInput(
		input: BedrockCoderCoreStartInput,
	): Promise<BedrockCoderCoreStartInput> | BedrockCoderCoreStartInput;
	dispose?(): Promise<void> | void;
}
