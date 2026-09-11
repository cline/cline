import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentExtension, BasicLogger } from "@cline/shared";
import { createTool } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";

/**
 * Built-in session extension exposing Composio-connected integrations
 * (Gmail, Google Calendar, GitHub, …) as agent tools.
 *
 * The management plane (OAuth connect/disconnect, key handling, dashboard
 * reconciliation) currently lives in the desktop app's sidecar; it persists
 * connection state and the fetched tool schemas to
 * `<cline-data>/settings/composio.json`. This extension is the consumption
 * side: it reads that file at session start and registers one tool per
 * stored schema, executing against Composio's REST API with the versions
 * pinned at connect time.
 *
 * Registering in-process (instead of the earlier generated drop-in plugin
 * in `~/.cline/plugins/`) keeps connector tools working in every host —
 * most importantly compiled binaries that cannot spawn the plugin sandbox,
 * such as the packaged desktop app — and gives CLI-hosted sessions the same
 * tools for free. Deleting the state file (or disconnecting every
 * integration) turns the tools off for new sessions; running sessions keep
 * their frozen tool set.
 */

const COMPOSIO_STATE_FILE_NAME = "composio.json";
const COMPOSIO_TOOL_TIMEOUT_MS = 120_000;

type StoredComposioTool = {
	slug: string;
	name?: string;
	description?: string;
	version?: string;
	inputParameters?: Record<string, unknown>;
};

type StoredComposioState = {
	apiKey?: string;
	userId?: string;
	toolkits?: Record<
		string,
		{ connectedAccountId?: string; tools?: StoredComposioTool[] } | undefined
	>;
};

function resolveComposioBaseUrl(): string {
	return (
		process.env.COMPOSIO_BASE_URL || "https://backend.composio.dev"
	).replace(/\/+$/, "");
}

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

async function executeComposioTool(
	apiKey: string,
	userId: string,
	tool: StoredComposioTool,
	input: unknown,
): Promise<unknown> {
	const url = `${resolveComposioBaseUrl()}/api/v3.1/tools/execute/${encodeURIComponent(tool.slug)}`;
	const body: Record<string, unknown> = {
		user_id: userId,
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
				"x-api-key": apiKey,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});
	} catch (error) {
		return {
			successful: false,
			error: `Composio request failed: ${error instanceof Error ? error.message : String(error)}`,
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
			error: `Composio returned HTTP ${response.status} for ${tool.slug}${preview ? `: ${preview}` : ""}`,
		};
	}
	return parsed ?? { successful: true };
}

/**
 * Builds the extension for the current connector state, or undefined when
 * there is nothing to register (no state file, no key, or no connected
 * toolkit with tools) — sessions without connectors pay one file read.
 *
 * The state is read once here, at session-bootstrap time, so a session's
 * tool set is frozen at start exactly like the previous plugin's was.
 */
export function createComposioToolsExtension(options?: {
	logger?: BasicLogger;
}): AgentExtension | undefined {
	const state = loadComposioState();
	// The desktop app persists the effective key into composio.json, but a
	// COMPOSIO_API_KEY exported to the host process works as a fallback.
	const apiKey =
		state?.apiKey || process.env.COMPOSIO_API_KEY?.trim() || undefined;
	const userId = state?.userId;
	if (!state?.toolkits || !apiKey || !userId) {
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
								execute: (input: unknown) =>
									executeComposioTool(apiKey, userId, tool, input),
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
