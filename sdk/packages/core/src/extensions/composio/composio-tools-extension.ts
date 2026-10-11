import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentExtension, BasicLogger } from "@cline/shared";
import { createTool, getClineEnvironmentConfig } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import {
	OAuthReauthRequiredError,
	RuntimeOAuthTokenManager,
} from "../../runtime/orchestration/runtime-oauth-token-manager";
import { resolveLocalClineAuthToken } from "../../services/providers/local-provider-service";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import {
	CONNECTORS_API_PATH,
	type ConnectorsRequest,
	createComposioMetaToolSession,
	executeComposioMetaTool,
} from "./composio-meta-tools";

/**
 * Local sessions load saved tool schemas and use the signed-in Cline account.
 * Hosts can supply their own authenticated transport to use meta tools without
 * local credentials or saved schemas. Both paths execute through the Cline API.
 */

const COMPOSIO_TOOL_TIMEOUT_MS = 120_000;

type StoredComposioTool = {
	slug: string;
	name?: string;
	description?: string;
	version?: string;
	input_parameters?: Record<string, unknown>;
};

type StoredComposioState = {
	toolkits?: Record<
		string,
		{ connectedAccountId?: string; tools?: StoredComposioTool[] } | undefined
	>;
};

export function resolveComposioToolsStatePath(accountId: string): string {
	const key = createHash("sha256").update(accountId).digest("hex");
	return join(resolveClineDataDir(), "settings", "composio", `${key}.json`);
}

function getAccountId(): string | undefined {
	return (
		new ProviderSettingsManager()
			.getProviderSettings("cline")
			?.auth?.accountId?.trim() || undefined
	);
}

function loadComposioState(accountId: string): StoredComposioState | undefined {
	try {
		const path = resolveComposioToolsStatePath(accountId);
		if (!existsSync(path)) {
			return undefined;
		}
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return typeof parsed === "object" && parsed !== null
			? (parsed as StoredComposioState)
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * Resolves the Cline account bearer token and API base URL for the proxy.
 * Uses the refresh-aware OAuth manager (tokens expire between launches) and
 * falls back to the persisted token on transient failures. Managers coordinate
 * single-use refresh tokens through a lock shared across processes.
 */
let sharedTokenManager: RuntimeOAuthTokenManager | undefined;

async function resolveConnectorsAuth(
	accountId: string,
): Promise<{ baseUrl: string; token: string } | undefined> {
	const manager = new ProviderSettingsManager();
	let token: string | undefined;
	try {
		sharedTokenManager ??= new RuntimeOAuthTokenManager();
		const resolution = await sharedTokenManager.resolveProviderApiKey({
			providerId: "cline",
		});
		token = resolution?.apiKey ?? undefined;
	} catch (error) {
		if (error instanceof OAuthReauthRequiredError) return undefined;
		// Fall back to the persisted token below.
	}
	token ??= resolveLocalClineAuthToken(manager.getProviderSettings("cline"));
	if (!token || getAccountId() !== accountId) {
		return undefined;
	}
	const settings = manager.getProviderSettings("cline");
	const baseUrl = (
		settings?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl
	).replace(/\/+$/, "");
	return { baseUrl, token };
}

async function executeComposioTool(
	request: ConnectorsRequest,
	tool: StoredComposioTool,
	input: unknown,
): Promise<unknown> {
	const url = `${CONNECTORS_API_PATH}/tools/${encodeURIComponent(tool.slug)}/execute`;
	const body: Record<string, unknown> = {
		arguments: input && typeof input === "object" ? input : {},
	};
	if (tool.version) {
		body.version = tool.version;
	}
	let response: Response;
	try {
		response = await request(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});
	} catch (error) {
		return {
			successful: false,
			error: `Cline connectors request failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	const text = await response.text();
	let parsed: unknown;
	try {
		parsed = text ? JSON.parse(text) : undefined;
	} catch {
		parsed = undefined;
	}
	if (!response.ok) {
		const preview =
			parsed !== undefined
				? JSON.stringify(parsed).slice(0, 600)
				: text.slice(0, 600);
		return {
			successful: false,
			error: `Cline connectors proxy returned HTTP ${response.status} for ${tool.slug}${preview ? `: ${preview}` : ""}`,
		};
	}
	return parsed ?? { successful: true };
}

/** Creates a fresh meta-tool session and registers any saved local tools. */
export async function createComposioToolsExtension(options?: {
	request?: ConnectorsRequest;
	logger?: BasicLogger;
}): Promise<AgentExtension | undefined> {
	const accountId = options?.request ? undefined : getAccountId();
	if (!options?.request && !accountId) return undefined;
	const request: ConnectorsRequest =
		options?.request ??
		(async (path, init) => {
			if (!accountId || getAccountId() !== accountId) {
				throw new Error(
					"The Cline account changed. Start a new session to use connector tools.",
				);
			}
			const auth = await resolveConnectorsAuth(accountId);
			if (!auth) {
				throw new Error(
					"Sign in to your Cline account to use connector tools (no account token available).",
				);
			}
			const headers = new Headers(init.headers);
			headers.set("authorization", `Bearer ${auth.token}`);
			return fetch(`${auth.baseUrl}${path}`, { ...init, headers });
		});
	const state = accountId ? loadComposioState(accountId) : undefined;
	const toolkits = Object.entries(state?.toolkits ?? {}).filter(
		([, toolkit]) =>
			toolkit?.connectedAccountId && (toolkit.tools?.length ?? 0) > 0,
	);
	const metaSession = await createComposioMetaToolSession(request, {
		log: (message) => options?.logger?.log?.(message),
	});
	if (toolkits.length === 0 && !metaSession?.tools.length) {
		return undefined;
	}
	return {
		name: "composio-tools",
		manifest: { capabilities: ["tools"] },
		setup(api) {
			if (accountId && getAccountId() !== accountId) return;
			const registered = new Set<string>();
			for (const [toolkitSlug, toolkitState] of toolkits) {
				for (const tool of toolkitState?.tools ?? []) {
					if (!tool?.slug) {
						continue;
					}
					const toolName = tool.slug.toLowerCase().replace(/[^a-z0-9_]/g, "_");
					if (registered.has(toolName)) {
						continue;
					}
					registered.add(toolName);
					try {
						api.registerTool(
							createTool({
								name: toolName,
								resultPolicy: "cache-oversized",
								description: `${tool.description || tool.name || tool.slug} (${toolkitSlug} account connected via Composio)`,
								inputSchema: (tool.input_parameters ?? {
									type: "object",
									properties: {},
								}) as never,
								timeoutMs: COMPOSIO_TOOL_TIMEOUT_MS,
								// Composio tools can have side effects (send an email,
								// open an issue); never auto-retry them.
								retryable: false,
								execute: (input: unknown) =>
									executeComposioTool(request, tool, input),
							}),
						);
					} catch (error) {
						// The schemas are external data persisted at connect time;
						// createTool rejects shapes it cannot represent (e.g. an
						// unsupported top-level allOf/oneOf/anyOf). One malformed
						// schema must cost only its own tool — a throw here would
						// propagate out of extension setup and block session
						// initialization for every tool and toolkit.
						registered.delete(toolName);
						options?.logger?.log?.(
							`composio-tools: skipping ${tool.slug}: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}
			}
			// The server allowlists which meta tools a session exposes; their
			// descriptions and schemas are Composio's, which reference each other.
			const metaSessionId = metaSession?.sessionId ?? "";
			for (const tool of metaSession?.tools ?? []) {
				const toolName = tool.slug.toLowerCase().replace(/[^a-z0-9_]/g, "_");
				if (registered.has(toolName)) {
					continue;
				}
				registered.add(toolName);
				try {
					api.registerTool(
						createTool({
							name: toolName,
							resultPolicy: "cache-oversized",
							description: tool.description || tool.name || tool.slug,
							inputSchema: (tool.input_parameters ?? {
								type: "object",
								properties: {},
							}) as never,
							timeoutMs: COMPOSIO_TOOL_TIMEOUT_MS,
							// Multi-execute runs app tools with side effects; never
							// auto-retry any meta tool.
							retryable: false,
							execute: (input: unknown) =>
								executeComposioMetaTool(
									request,
									metaSessionId,
									tool.slug,
									input,
								),
						}),
					);
				} catch (error) {
					registered.delete(toolName);
					options?.logger?.log?.(
						`composio-tools: skipping ${tool.slug}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			options?.logger?.log?.(
				`composio-tools: registered ${registered.size} connector tool(s) for this session`,
			);
		},
	};
}
