import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentExtension, BasicLogger } from "@cline/shared";
import { createTool, getClineEnvironmentConfig } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import { RuntimeOAuthTokenManager } from "../../runtime/orchestration/runtime-oauth-token-manager";
import { resolveLocalClineAuthToken } from "../../services/providers/local-provider-service";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";

/**
 * Built-in session extension exposing Composio-connected integrations
 * (Gmail, Google Calendar, GitHub, …) as agent tools.
 *
 * The management plane (connect/disconnect, reconciliation) lives in the
 * desktop app's sidecar and persists connection state plus fetched tool
 * schemas to `<cline-data>/settings/composio.json`. This extension is the
 * consumption side: it reads that file at session start, registers one tool
 * per stored schema, and executes each tool through the **Cline API
 * connectors proxy** (`/v1/connectors/composio/tools/{slug}/execute`) — the
 * proxy holds the Composio key server-side and derives the Composio user_id
 * from the authenticated Cline account, so no Composio key ever reaches this
 * process. Execution therefore requires a signed-in Cline account; a
 * signed-out session's connector tools return a structured auth error.
 *
 * Registering in-process (instead of the earlier generated drop-in plugin in
 * `~/.cline/plugins/`) keeps connector tools working in every host — most
 * importantly compiled binaries that cannot spawn the plugin sandbox, such as
 * the packaged desktop app — and gives CLI-hosted sessions the same tools.
 * Deleting the state file (or disconnecting every integration) turns the
 * tools off for new sessions; running sessions keep their frozen tool set.
 */

const COMPOSIO_STATE_FILE_NAME = "composio.json";
const COMPOSIO_TOOL_TIMEOUT_MS = 120_000;
const CONNECTORS_API_PATH = "/v1/connectors/composio";

type StoredComposioTool = {
	slug: string;
	name?: string;
	description?: string;
	version?: string;
	inputParameters?: Record<string, unknown>;
};

type StoredComposioState = {
	toolkits?: Record<
		string,
		{ connectedAccountId?: string; tools?: StoredComposioTool[] } | undefined
	>;
};

export function resolveComposioToolsStatePath(): string {
	return join(resolveClineDataDir(), "settings", COMPOSIO_STATE_FILE_NAME);
}

function loadComposioState(): StoredComposioState | undefined {
	try {
		const path = resolveComposioToolsStatePath();
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
 * falls back to the persisted token. One manager per process — the refresh
 * token is single-use.
 */
let sharedTokenManager: RuntimeOAuthTokenManager | undefined;

async function resolveConnectorsAuth(): Promise<
	{ baseUrl: string; token: string } | undefined
> {
	const manager = new ProviderSettingsManager();
	let token: string | undefined;
	try {
		sharedTokenManager ??= new RuntimeOAuthTokenManager();
		const resolution = await sharedTokenManager.resolveProviderApiKey({
			providerId: "cline",
		});
		token = resolution?.apiKey ?? undefined;
	} catch {
		// Fall back to the persisted token below.
	}
	token ??= resolveLocalClineAuthToken(manager.getProviderSettings("cline"));
	if (!token) {
		return undefined;
	}
	const settings = manager.getProviderSettings("cline");
	const baseUrl = (
		settings?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl
	).replace(/\/+$/, "");
	return { baseUrl, token };
}

async function executeComposioTool(
	tool: StoredComposioTool,
	input: unknown,
): Promise<unknown> {
	const auth = await resolveConnectorsAuth();
	if (!auth) {
		return {
			successful: false,
			error:
				"Sign in to your Cline account to use connector tools (no account token available).",
		};
	}
	const url = `${auth.baseUrl}${CONNECTORS_API_PATH}/tools/${encodeURIComponent(tool.slug)}/execute`;
	const body: Record<string, unknown> = {
		arguments: input && typeof input === "object" ? input : {},
	};
	if (tool.version) {
		body.version = tool.version;
	}
	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				authorization: `Bearer ${auth.token}`,
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

/**
 * Builds the extension for the current connector state, or undefined when
 * there is nothing to register (no state file, or no connected toolkit with
 * tools) — sessions without connectors pay one file read.
 *
 * The state is read once here, at session-bootstrap time, so a session's
 * tool set is frozen at start exactly like the previous plugin's was.
 */
export function createComposioToolsExtension(options?: {
	logger?: BasicLogger;
}): AgentExtension | undefined {
	const state = loadComposioState();
	if (!state?.toolkits) {
		return undefined;
	}
	const toolkits = Object.entries(state.toolkits).filter(
		([, toolkit]) =>
			toolkit?.connectedAccountId && (toolkit.tools?.length ?? 0) > 0,
	);
	if (toolkits.length === 0) {
		return undefined;
	}
	return {
		name: "composio-tools",
		manifest: { capabilities: ["tools"] },
		setup(api) {
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
								description: `${tool.description || tool.name || tool.slug} (${toolkitSlug} account connected via Composio)`,
								inputSchema: (tool.inputParameters ?? {
									type: "object",
									properties: {},
								}) as never,
								timeoutMs: COMPOSIO_TOOL_TIMEOUT_MS,
								// Composio tools can have side effects (send an email,
								// open an issue); never auto-retry them.
								retryable: false,
								execute: (input: unknown) => executeComposioTool(tool, input),
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
			options?.logger?.log?.(
				`composio-tools: registered ${registered.size} connector tool(s) for this session`,
			);
		},
	};
}
