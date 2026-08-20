import type { ChildProcess } from "node:child_process";
import type { GatewayClient } from "@cline/gateway/client";

export type SidecarSocket = { send(message: string): void };

export interface SidecarContext {
	client: GatewayClient;
	ownedProcess?: ChildProcess;
	gatewayUpdateRequired: boolean;
	updateGateway(): Promise<void>;
	workspaceRoot: string;
	sockets: Set<SidecarSocket>;
	activeRuns: Map<string, string>;
	pendingApprovals: Map<string, { sessionId?: string; request: unknown }>;
}

export const SIDECAR_PORT = Number(process.env.CLINE_SIDECAR_PORT) || 3126;
export const SIDECAR_HOST = process.env.CLINE_SIDECAR_HOST?.trim() || "127.0.0.1";
