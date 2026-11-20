import type { McpToolDescriptor } from "./types";

export const MCP_APPS_EXTENSION_ID = "io.modelcontextprotocol/ui";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
export const MCP_APP_RESOURCE_URI_SCHEME = "ui:";

export type McpAppToolVisibility = "model" | "app";

export interface McpAppToolMeta {
	resourceUri?: string;
	visibility: readonly McpAppToolVisibility[];
}

const DEFAULT_VISIBILITY: readonly McpAppToolVisibility[] = ["model", "app"];

export function createMcpAppsClientCapabilities(): {
	extensions: Record<string, Record<string, unknown>>;
} {
	return {
		extensions: {
			[MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME_TYPE] },
		},
	};
}

export function isMcpAppResourceUri(uri: string): boolean {
	try {
		return new URL(uri).protocol === MCP_APP_RESOURCE_URI_SCHEME;
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getMcpAppToolMeta(
	tool: Pick<McpToolDescriptor, "_meta">,
): McpAppToolMeta | undefined {
	const ui = tool._meta?.ui;
	if (!isRecord(ui)) {
		return undefined;
	}
	const resourceUri =
		typeof ui.resourceUri === "string" && isMcpAppResourceUri(ui.resourceUri)
			? ui.resourceUri
			: undefined;
	const visibility = Array.isArray(ui.visibility)
		? ui.visibility.filter(
				(entry): entry is McpAppToolVisibility =>
					entry === "model" || entry === "app",
			)
		: DEFAULT_VISIBILITY;
	return { resourceUri, visibility };
}

export function isMcpToolVisibleToModel(
	tool: Pick<McpToolDescriptor, "_meta">,
): boolean {
	return getMcpAppToolMeta(tool)?.visibility.includes("model") ?? true;
}

export function isMcpToolVisibleToApp(
	tool: Pick<McpToolDescriptor, "_meta">,
): boolean {
	return getMcpAppToolMeta(tool)?.visibility.includes("app") ?? true;
}
