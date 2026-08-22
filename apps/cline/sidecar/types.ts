import type { GatewayClient } from "@cline/gateway/client";
import type { GatewayServerRequest } from "@cline/shared/gateway";
import pkg from "../package.json";

export type SidecarSocket = { send(message: string): void };

export interface SidecarContext {
	client: GatewayClient;
	gatewayUpdateRequired: boolean;
	updateGateway(): Promise<void>;
	/** Native-host-selected bot for a per-bot desktop sidecar. */
	botId?: string;
	workspaceRoot: string;
	/** Ignore webview workspace overrides when the native host resolved access. */
	workspaceRootLocked: boolean;
	/** Browser-facing desktop bridge address; never the private Gateway socket. */
	webSocketAddress?: string;
	sockets: Set<SidecarSocket>;
	activeRuns: Map<string, string>;
	pendingServerRequests: Map<string, GatewayServerRequest>;
}

export function resolveSidecarPort(
	value = process.env.CLINE_SIDECAR_PORT,
): number {
	if (value === undefined || value.trim() === "") return 3126;
	const port = Number(value);
	if (!Number.isInteger(port) || port < 0 || port > 65_535) {
		throw new Error(`Invalid CLINE_SIDECAR_PORT: ${value}`);
	}
	return port;
}

// Native debug mode runs one sidecar per bot/workspace and passes 0 so the
// OS assigns each process a unique loopback port. The persistent packaged
// service and browser-only development mode explicitly keep using 3126.
export const SIDECAR_PORT = resolveSidecarPort();
export const SIDECAR_HOST =
	process.env.CLINE_SIDECAR_HOST?.trim() || "127.0.0.1";
export const SIDECAR_VERSION = pkg.version;
