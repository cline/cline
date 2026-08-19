/** Gateway-owned model and credential resolution at the engine boundary. */
import type {
	EngineInvocation,
	EngineOutcome,
	EnginePort,
	EngineRunHandle,
} from "@cline/bot";
import { createEngineExecutionPort } from "@cline/bot";
import type { AgentTool, EngineModelBinding } from "@cline/engine";
import {
	createPrincipalId,
	SERVER_REQUEST_METHODS,
} from "@cline/shared/gateway";
import { createBuiltinCodingTools } from "@cline/tools";
import type { ResolvedLeadProfile } from "./lead-profiles";
import { definitionsFromPlugin } from "./mcp/definitions";
import { McpConnectionPool, type McpLease } from "./mcp/pool";
import { createStdioTransportFactory } from "./mcp/transport";
import { SessionMcpToolView } from "./mcp/views";
import type { GatewayPaths } from "./paths";
import { loadPlugin } from "./plugins/loader";
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
	/** Built-in lead profile whose Agent Plugin tools are available to runs. */
	leadProfile?: ResolvedLeadProfile;
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

export function resolveProviderModelSelection(
	invocation: EngineInvocation,
	options: Pick<
		ResolveProviderModelOptions,
		"env" | "providerSettingsPath"
	> = {},
): { providerId: string; modelId: string } {
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
			"No model configured: configure providers.json, bot config, or Gateway environment overrides",
		);
	}
	return { providerId, modelId };
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
	const selection = resolveProviderModelSelection(invocation, options);
	const saved = readSavedProviderSelection(selection.providerId, {
		filePath: options.providerSettingsPath,
		env,
	});
	const { providerId, modelId } = selection;
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
	const mcpPool = new McpConnectionPool({
		transportFactory: createStdioTransportFactory(),
	});
	const principalId = createPrincipalId();

	async function acquireProfileTools(invocation: EngineInvocation): Promise<{
		tools: AgentTool[];
		leases: McpLease[];
		definitionNames: string[];
	}> {
		if (
			!options.leadProfile ||
			invocation.effectiveConfig.profileId !== options.leadProfile.id
		) {
			return { tools: [], leases: [], definitionNames: [] };
		}
		const leases: McpLease[] = [];
		const definitionNames: string[] = [];
		const tools: AgentTool[] = [];
		const names = new Set<string>();
		try {
			for (const root of options.leadProfile.pluginRoots) {
				const loaded = loadPlugin(root);
				if (!loaded.ok) {
					throw new Error(
						`Unable to load lead plugin ${root}: ${loaded.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
					);
				}
				for (const definition of definitionsFromPlugin(loaded.plugin)) {
					if (definition.transport.kind !== "stdio") continue;
					const scopedDefinition = {
						...definition,
						name: `${definition.name}@${invocation.sessionId}`,
						transport: {
							...definition.transport,
							env: {
								...definition.transport.env,
								CLINE_WORKSPACE_ROOT: invocation.workspaceRoot,
								CLINE_SESSION_ID: invocation.sessionId,
							},
						},
					} as const;
					const lease = await mcpPool.acquire({
						definition: scopedDefinition,
						principalId,
						botId: invocation.botId,
						workspaceId: invocation.workspaceRoot,
					});
					leases.push(lease);
					definitionNames.push(scopedDefinition.name);
					const view = new SessionMcpToolView(lease);
					for (const descriptor of await view.listTools()) {
						if (!descriptor.name) continue;
						if (names.has(descriptor.name)) {
							throw new Error(
								`Duplicate lead plugin tool name: ${descriptor.name}`,
							);
						}
						names.add(descriptor.name);
						tools.push({
							name: descriptor.name,
							description:
								descriptor.description ?? `Tool provided by ${view.serverName}`,
							inputSchema:
								typeof descriptor.inputSchema === "object" &&
								descriptor.inputSchema !== null &&
								!Array.isArray(descriptor.inputSchema)
									? (descriptor.inputSchema as Record<string, unknown>)
									: { type: "object" },
							execute: (input) =>
								view.callTool(
									descriptor.name,
									typeof input === "object" && input !== null
										? (input as Record<string, unknown>)
										: {},
								),
						});
					}
				}
			}
			return { tools, leases, definitionNames };
		} catch (error) {
			for (const lease of leases) lease.release();
			throw error;
		}
	}
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
				const profileTools = await acquireProfileTools(invocation);
				const handle = createEngineExecutionPort({
					model: () => model,
					tools: (resolvedInvocation) => [
						...createBuiltinCodingTools({
							workspaceRoot: resolvedInvocation.workspaceRoot,
							enabledToolNames: resolvedInvocation.executionSnapshot?.tools
								.filter(
									(tool) =>
										tool.executorId === "worker:builtin" ||
										tool.executorId === "gateway:builtin",
								)
								.map((tool) => tool.modelFacingName),
							...(approvals
								? {
										askQuestion: (
											question: string,
											choices: readonly string[],
										) =>
											approvals.request(
												SERVER_REQUEST_METHODS.question,
												{
													botId: resolvedInvocation.botId,
													sessionId: resolvedInvocation.sessionId,
													runId: resolvedInvocation.runId,
												},
												{ question, options: choices },
											),
									}
								: {}),
						}),
						...profileTools.tools,
					],
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
				void handle.result.finally(() => {
					for (const name of profileTools.definitionNames) {
						mcpPool.drainDefinition(name);
					}
					for (const lease of profileTools.leases) lease.release();
				});
				return handle;
			});
		},
	};
}
