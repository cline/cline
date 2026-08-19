/** Gateway-owned model and credential resolution at the engine boundary. */
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
import {
	readSavedProviderSelection,
	resolveSavedClineOAuthApiKey,
	savedProviderApiKey,
	savedProviderOptions,
} from "./provider-settings";
import type { ApprovalBroker } from "./runtime";
import { readSecretFile } from "./secrets";

export class ModelNotConfiguredError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ModelNotConfiguredError";
	}
}

export class MissingProviderCredentialError extends Error {
	constructor(providerId: string) {
		super(
			`No credential for provider "${providerId}": configure providers.json, create it with \`cline-gateway secret-put ${providerId}\`, or set an environment override`,
		);
		this.name = "MissingProviderCredentialError";
	}
}

export interface ConfiguredEngineOptions {
	approvals?: ApprovalBroker | (() => ApprovalBroker | undefined);
	resolveModel?: (
		invocation: EngineInvocation,
	) => EngineModelBinding | Promise<EngineModelBinding>;
	paths?: GatewayPaths;
	env?: Record<string, string | undefined>;
	providerSettingsPath?: string;
}

const PROVIDER_KEY_ENV: Record<string, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	openai: "OPENAI_API_KEY",
	cline: "CLINE_API_KEY",
	gemini: "GEMINI_API_KEY",
	google: "GOOGLE_API_KEY",
	mistral: "MISTRAL_API_KEY",
};

export interface ResolveProviderModelOptions {
	env?: Record<string, string | undefined>;
	paths?: GatewayPaths;
	providerSettingsPath?: string;
	resolvedApiKey?: string;
}

function providerCredentialOverride(
	providerId: string,
	options: ResolveProviderModelOptions,
): string | undefined {
	const env = options.env ?? process.env;
	return (
		env.CLINE_GATEWAY_API_KEY ??
		env[PROVIDER_KEY_ENV[providerId] ?? ""] ??
		(options.paths ? readSecretFile(options.paths, providerId) : undefined)
	);
}

export function resolveProviderModel(
	invocation: EngineInvocation,
	options: ResolveProviderModelOptions = {},
): Extract<EngineModelBinding, { kind: "provider" }> {
	const env = options.env ?? process.env;
	const explicitProviderId =
		invocation.effectiveConfig.providerId ?? env.CLINE_GATEWAY_PROVIDER;
	const saved = readSavedProviderSelection(explicitProviderId, {
		filePath: options.providerSettingsPath,
		env,
	});
	const providerId = explicitProviderId ?? saved?.providerId;
	const modelId =
		invocation.effectiveConfig.modelId ??
		env.CLINE_GATEWAY_MODEL ??
		saved?.settings.model;
	if (!providerId || !modelId) {
		throw new ModelNotConfiguredError(
			"No model configured: configure providers.json, bot config, or CLINE_GATEWAY_PROVIDER / CLINE_GATEWAY_MODEL",
		);
	}
	const apiKey =
		options.resolvedApiKey ??
		providerCredentialOverride(providerId, options) ??
		(saved ? savedProviderApiKey(providerId, saved.settings) : undefined);
	if (!apiKey) throw new MissingProviderCredentialError(providerId);
	return {
		kind: "provider",
		providerId,
		modelId,
		apiKey,
		baseUrl: saved?.settings.baseUrl,
		headers: saved?.settings.headers,
		timeoutMs: saved?.settings.timeout,
		options: saved ? savedProviderOptions(saved.settings) : undefined,
	};
}

export function resolveModelFromEnvironment(
	invocation: EngineInvocation,
	env: Record<string, string | undefined> = process.env,
	providerSettingsPath?: string,
): EngineModelBinding {
	return resolveProviderModel(invocation, { env, providerSettingsPath });
}

function failedOutcome(error: unknown): EngineOutcome {
	return {
		status: "failed",
		outputText: "",
		error: {
			name: error instanceof Error ? error.name : "EngineBindingError",
			message: error instanceof Error ? error.message : String(error),
		},
	};
}

/** Bridge async OAuth resolution onto the synchronous EnginePort contract. */
function deferredHandle(
	start: () => Promise<EngineRunHandle>,
): EngineRunHandle {
	let delegate: EngineRunHandle | undefined;
	let interrupted: string | undefined;
	let aborted: string | undefined;
	const listeners = new Set<(event: unknown) => void>();
	const ready = start().then((handle) => {
		delegate = handle;
		for (const listener of listeners) handle.subscribe?.(listener);
		if (aborted !== undefined) handle.abort(aborted);
		else if (interrupted !== undefined) handle.interrupt(interrupted);
		return handle;
	});
	return {
		steer: (text) => delegate?.steer(text) ?? false,
		interrupt: (reason) => {
			interrupted = reason ?? "";
			delegate?.interrupt(reason);
		},
		abort: (reason) => {
			aborted = reason ?? "";
			delegate?.abort(reason);
		},
		result: ready.then((handle) => handle.result).catch(failedOutcome),
		subscribe: (listener) => {
			listeners.add(listener);
			const unsubscribe = delegate?.subscribe?.(listener);
			return () => {
				listeners.delete(listener);
				unsubscribe?.();
			};
		},
	};
}

export function createConfiguredEnginePort(
	options: ConfiguredEngineOptions = {},
): EnginePort {
	let clineRefreshInFlight: Promise<string | undefined> | undefined;
	return {
		start(invocation): EngineRunHandle {
			return deferredHandle(async () => {
				let model: EngineModelBinding;
				if (options.resolveModel) {
					model = await options.resolveModel(invocation);
				} else {
					const resolutionOptions = {
						env: options.env,
						paths: options.paths,
						providerSettingsPath: options.providerSettingsPath,
					};
					const preliminary = resolveProviderModel(
						invocation,
						resolutionOptions,
					);
					const hasOverride = providerCredentialOverride(
						preliminary.providerId,
						resolutionOptions,
					);
					let oauthApiKey: string | undefined;
					if (
						!hasOverride &&
						(preliminary.providerId === "cline" ||
							preliminary.providerId === "cline-pass")
					) {
						clineRefreshInFlight ??= resolveSavedClineOAuthApiKey(
							preliminary.providerId,
							{
								filePath: options.providerSettingsPath,
								env: options.env,
							},
						).finally(() => {
							clineRefreshInFlight = undefined;
						});
						oauthApiKey = await clineRefreshInFlight;
					}
					model = oauthApiKey
						? resolveProviderModel(invocation, {
								...resolutionOptions,
								resolvedApiKey: oauthApiKey,
							})
						: preliminary;
				}
				const approvals =
					typeof options.approvals === "function"
						? options.approvals()
						: options.approvals;
				return createEngineExecutionPort({
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
				}).start(invocation);
			});
		},
	};
}
