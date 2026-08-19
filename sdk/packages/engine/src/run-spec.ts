/**
 * `RunSpec` — the immutable description of exactly one execution
 * (Gateway RFC, Phase 1).
 *
 * Everything an engine touches is supplied by the caller: model binding,
 * tools, hooks, approval port, artifact sink, clock, telemetry. The engine
 * owns no storage, no discovery, no sockets, no daemon, and no global
 * singleton; a caller that wants persistence applies the `RunResult`'s
 * persistence deltas itself.
 */

import type {
	AgentMessage,
	AgentModel,
	AgentRuntimeHooks,
	AgentTool,
	BasicLogger,
	ITelemetryService,
	ToolApprovalRequest,
	ToolApprovalResult,
	ToolPolicy,
} from "@cline/shared";

/**
 * How the engine binds a model. Either the caller injects a pre-built
 * `AgentModel`, or it names a provider/model and the underlying
 * `@cline/agents` + `@cline/llms` stack constructs the handler.
 */
export type EngineModelBinding =
	| {
			kind: "model";
			model: AgentModel;
			/** Optional attribution stamped onto assistant messages. */
			modelInfo?: { id: string; provider: string };
	  }
	| {
			kind: "provider";
			providerId: string;
			modelId: string;
			apiKey?: string;
			baseUrl?: string;
			headers?: Record<string, string>;
			timeoutMs?: number;
			options?: Record<string, unknown>;
	  };

/** Injected clock so engines are deterministic under test. */
export interface EngineClock {
	now(): number;
}

/** Artifact produced by tools or hooks during a run. */
export interface EngineArtifact {
	name: string;
	mediaType?: string;
	data: string | Uint8Array;
	metadata?: Record<string, unknown>;
}

/** Caller-supplied artifact sink; the engine never touches a filesystem. */
export interface EngineArtifactSink {
	put(artifact: EngineArtifact): void | Promise<void>;
}

/** Caller-supplied approval port for tools that are not auto-approved. */
export type EngineApprovalPort = (
	request: ToolApprovalRequest,
) => Promise<ToolApprovalResult> | ToolApprovalResult;

export interface RunSpec {
	/** Run identity, issued by the caller (e.g. at Gateway admission). */
	runId: string;
	/** Session/bot attribution passed through to tools and telemetry. */
	sessionId?: string;
	botId?: string;
	/** The prompt (or pre-normalized messages) that starts this run. */
	input: string | readonly AgentMessage[];
	/** Canonical history the run continues from. */
	initialMessages?: readonly AgentMessage[];
	systemPrompt?: string;
	model: EngineModelBinding;
	// biome-ignore lint/suspicious/noExplicitAny: tool input/output types vary per tool
	tools?: readonly AgentTool<any, any>[];
	hooks?: Partial<AgentRuntimeHooks>;
	toolPolicies?: Record<string, ToolPolicy>;
	/** Required whenever a tool policy disables auto-approval. */
	requestApproval?: EngineApprovalPort;
	maxIterations?: number;
	/** Opaque metadata forwarded to tool execution contexts. */
	metadata?: Record<string, unknown>;
}

export interface EngineOptions {
	clock?: EngineClock;
	telemetry?: ITelemetryService;
	logger?: BasicLogger;
	artifacts?: EngineArtifactSink;
}

export const SYSTEM_CLOCK: EngineClock = {
	now: () => Date.now(),
};
