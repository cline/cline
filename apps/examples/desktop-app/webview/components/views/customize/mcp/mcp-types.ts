import type { McpServer } from "@/lib/extension-inventory";
import type { MarketplaceEntry } from "@/lib/marketplace";

export type McpTransportType = "stdio" | "sse" | "streamableHttp";

export type McpActionError = {
	message: string;
	status: "action-failed" | "delete-failed" | "connection-error";
};

export const TRANSPORT_TYPE_LABELS: Record<McpTransportType, string> = {
	stdio: "Local · stdio",
	sse: "Remote · SSE (legacy)",
	streamableHttp: "Remote · Streamable HTTP",
};

export interface McpServerUpsertInput {
	name: string;
	previousName?: string;
	transportType: McpTransportType;
	command?: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	disabled?: boolean;
	metadata?: unknown;
}

export type InstalledMcpSelection =
	| { server: McpServer; entry?: MarketplaceEntry }
	| { server?: undefined; entry: MarketplaceEntry };
