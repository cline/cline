/**
 * Default engine binding for a serving Gateway (Gateway RFC, Phase 3).
 *
 * Wraps the Phase 2 composition proof (`createEngineExecutionPort` over
 * the real `@cline/engine`) with:
 *
 * - model resolution from the run's snapshotted config;
 * - credential injection owned by the Gateway (ADR 0001): the provider
 *   key comes from the owner-only mode-0600 secret file
 *   `<dataDir>/secrets/<providerId>`, with environment variables
 *   (`CLINE_GATEWAY_API_KEY`, provider-specific keys) as a local/dev
 *   override. The key lives in memory at the engine boundary only —
 *   never in the database, events, projections, or logs;
 * - tool approvals routed through the ApprovalBroker as server-initiated
 *   requests to subscribed clients;
 * - fail-fast handles: a run whose model or credential cannot be
 *   resolved settles as a failed attempt with a stable error instead of
 *   poisoning admission.
 */

import type {
	EngineInvocation,
	EngineOutcome,
	EnginePort,
	EngineRunHandle,
} from "@cline/bot";
import { createEngineExecutionPort } from "@cline/bot";
import type { EngineModelBinding } from "@cline/engine";
import { SERVER_REQUEST_METHODS } from "@cline/shared/gateway";
import type { GatewayPaths } from "./paths";
import type { ApprovalBroker } from "./runtime";
import { readSecretFile } from "./secrets";

/** Stable failure: the run's provider/model is not configured. */
export class ModelNotConfiguredError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ModelNotConfiguredError";
	}
}

/** Stable failure: no credential for the run's provider. */
export class MissingProviderCredentialError extends Error {
	constructor(providerId: string) {
		super(
			`No credential for provider "${providerId}": create the owner-only secret file ` +
				`with \`cline-gateway secret-put ${providerId}\` (or drop a mode-0600 file into ` +
				`the data directory's secrets/), or set an environment override`,
		);
		this.name = "MissingProviderCredentialError";
	}
}

export interface ConfiguredEngineOptions {
	/**
	 * Route tool approvals to clients as server requests. A getter is
	 * accepted because the broker lives on the runtime, which is created
	 * after the engine port (the server takes the port as an option).
	 */
	approvals?: ApprovalBroker | (() => ApprovalBroker | undefined);
	/** Override model resolution (defaults to snapshot + secrets + env). */
	resolveModel?: (invocation: EngineInvocation) => EngineModelBinding;
	/** Data directory paths; enables mode-0600 secret file lookup. */
	paths?: GatewayPaths;
	env?: Record<string, string | undefined>;
}

const PROVIDER_KEY_ENV: Record<string, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	openai: "OPENAI_API_KEY",
	cline: "CLINE_API_KEY",
};

export interface ResolveProviderModelOptions {
	env?: Record<string, string | undefined>;
	/** Enables `<dataDir>/secrets/<providerId>` lookup. */
	paths?: GatewayPaths;
}

/**
 * Resolve the model binding for one invocation. Provider and model come
 * from the invocation's (snapshotted) config, with environment defaults;
 * the credential comes from the environment override when present,
 * otherwise from the provider's mode-0600 secret file. A missing
 * credential throws `MissingProviderCredentialError` — an unauthenticated
 * binding is never handed to the engine.
 */
export function resolveProviderModel(
	invocation: EngineInvocation,
	options: ResolveProviderModelOptions = {},
): EngineModelBinding {
	const env = options.env ?? process.env;
	const providerId =
		invocation.effectiveConfig.providerId ?? env.CLINE_GATEWAY_PROVIDER;
	const modelId = invocation.effectiveConfig.modelId ?? env.CLINE_GATEWAY_MODEL;
	if (!providerId || !modelId) {
		throw new ModelNotConfiguredError(
			"No model configured: set bot config or CLINE_GATEWAY_PROVIDER / CLINE_GATEWAY_MODEL",
		);
	}
	const apiKey =
		env.CLINE_GATEWAY_API_KEY ??
		env[PROVIDER_KEY_ENV[providerId] ?? ""] ??
		(options.paths ? readSecretFile(options.paths, providerId) : undefined);
	if (!apiKey) {
		throw new MissingProviderCredentialError(providerId);
	}
	return { kind: "provider", providerId, modelId, apiKey };
}

function failedHandle(error: unknown): EngineRunHandle {
	const outcome: EngineOutcome = {
		status: "failed",
		outputText: "",
		error: {
			name: error instanceof Error ? error.name : "EngineBindingError",
			message: error instanceof Error ? error.message : String(error),
		},
	};
	return {
		steer: () => false,
		interrupt: () => {},
		abort: () => {},
		result: Promise.resolve(outcome),
	};
}

/** Real engine port for a serving Gateway. */
export function createConfiguredEnginePort(
	options: ConfiguredEngineOptions = {},
): EnginePort {
	return {
		start(invocation: EngineInvocation): EngineRunHandle {
			try {
				const model =
					options.resolveModel?.(invocation) ??
					resolveProviderModel(invocation, {
						env: options.env,
						paths: options.paths,
					});
				const approvals =
					typeof options.approvals === "function"
						? options.approvals()
						: options.approvals;
				const port = createEngineExecutionPort({
					model: () => model,
					requestApproval: approvals
						? async (request) => {
								const answer = await approvals.request(
									SERVER_REQUEST_METHODS.toolApproval,
									{
										botId: invocation.botId,
										sessionId: invocation.sessionId,
										runId: invocation.runId,
									},
									{
										toolCallId: request.toolCallId,
										toolName: request.toolName,
										input: request.input as Record<string, unknown> | undefined,
									},
								);
								const shaped = answer as {
									approved?: unknown;
									reason?: unknown;
								} | null;
								return {
									approved: shaped?.approved === true,
									reason:
										typeof shaped?.reason === "string"
											? shaped.reason
											: undefined,
								};
							}
						: undefined,
				});
				return port.start(invocation);
			} catch (error) {
				return failedHandle(error);
			}
		},
	};
}
