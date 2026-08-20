import type { GatewayClient } from "@cline/gateway/client";

export type SidecarSocket = { send(message: string): void };

export interface SidecarContext {
	client: GatewayClient;
	workspaceRoot: string;
	sockets: Set<SidecarSocket>;
	activeRuns: Map<string, string>;
	pendingApprovals: Map<string, { sessionId?: string; request: unknown }>;
}

export const SIDECAR_PORT = Number(process.env.CLINE_SIDECAR_PORT) || 3126;
export const SIDECAR_HOST = process.env.CLINE_SIDECAR_HOST?.trim() || "127.0.0.1";
