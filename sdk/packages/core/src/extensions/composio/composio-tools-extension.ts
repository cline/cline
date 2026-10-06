import { existsSync, readFileSync } from "node:fs";
import type { AgentExtension, BasicLogger } from "@cline/shared";
import { createTool } from "@cline/shared";
import {
	type ConnectorsRequest,
	type ConnectorToolSchema,
	executeConnectorTool,
} from "../../services/connectors/cline-connectors-api";
import {
	normalizeComposioTool,
	resolveComposioToolsStatePath,
	type StoredComposioTool,
} from "../../services/connectors/composio-tools";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";

/**
 * Registers Composio schemas as tools and executes through core-platform.
 * Desktop/CLI use the saved account state and login by default. Other hosts
 * supply schemas from listToolkitTools and their authenticated request function.
 * Both paths share tool registration, execution, and result handling.
 */

const COMPOSIO_TOOL_TIMEOUT_MS = 120_000;
type StoredComposioState = {
	toolkits?: Record<
		string,
		{ connectedAccountId?: string; tools?: StoredComposioTool[] } | undefined
	>;
};

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

export type ComposioToolsExtensionOptions = { logger?: BasicLogger } & (
	| {
			/** Schemas for the host's active connections, keyed by toolkit slug. */
			toolkits: Readonly<Record<string, readonly ConnectorToolSchema[]>>;
			/** Same user-scoped transport used to fetch the supplied schemas. */
			request: ConnectorsRequest;
	  }
	| { toolkits?: undefined; request?: undefined }
);

/** Build a fixed tool set from supplied schemas or the current local state.
 * Supplying schemas requires a host request; the SDK never mixes them with a
 * saved desktop identity. An empty snapshot registers no extension.
 */
export async function createComposioToolsExtension(
	options?: ComposioToolsExtensionOptions,
): Promise<AgentExtension | undefined> {
	const request = options?.request;
	let accountId: string | undefined;
	let toolkits: [string, readonly ConnectorToolSchema[]][];
	if (options?.request) {
		toolkits = Object.entries(structuredClone(options.toolkits)).map(
			([slug, tools]) => [
				slug,
				tools.map(normalizeComposioTool).filter((tool) => tool !== undefined),
			],
		);
	} else {
		accountId = getAccountId();
		if (!accountId) return undefined;
		const state = loadComposioState(accountId);
		if (!state?.toolkits) return undefined;
		toolkits = Object.entries(state.toolkits)
			.filter(([, toolkit]) => toolkit?.connectedAccountId)
			.map(([slug, toolkit]) => [slug, toolkit?.tools ?? []]);
	}
	toolkits = toolkits.filter(([, tools]) => tools.length > 0);
	if (toolkits.length === 0) return undefined;

	return {
		name: "composio-tools",
		manifest: { capabilities: ["tools"] },
		setup(api) {
			if (!request && getAccountId() !== accountId) return;
			const registered = new Set<string>();
			for (const [toolkitSlug, tools] of toolkits) {
				for (const tool of tools) {
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
								inputSchema: (tool.input_parameters ?? {
									type: "object",
									properties: {},
								}) as never,
								timeoutMs: COMPOSIO_TOOL_TIMEOUT_MS,
								// Composio tools can have side effects (send an email,
								// open an issue); never auto-retry them.
								retryable: false,
								execute: async (input: unknown) => {
									if (!request && getAccountId() !== accountId) {
										return {
											successful: false,
											error:
												"The Cline account changed. Start a new session to use connector tools.",
										};
									}
									return executeConnectorTool(tool, input, {
										request,
										accountId,
									});
								},
							}),
						);
					} catch (error) {
						// Schemas come from the provider (or a saved snapshot);
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
