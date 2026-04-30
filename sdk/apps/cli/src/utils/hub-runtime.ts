import {
	type DetachedHubResolution,
	ensureDetachedHubServer,
	type HubEndpointOverrides,
	resolveDefaultHubHost,
	resolveDefaultHubPort,
} from "@clinebot/core";

/**
 * Build a `host:port` rpc address string that respects the current build
 * environment. In development, this picks the dev hub port to avoid
 * colliding with a production Cline hub on the standard port.
 */
export function resolveDefaultCliRpcAddress(): string {
	return `${resolveDefaultHubHost()}:${resolveDefaultHubPort()}`;
}

export function parseHubEndpointOverride(
	rawAddress: string | undefined,
): HubEndpointOverrides {
	const trimmed = rawAddress?.trim();
	if (!trimmed) {
		return {};
	}
	try {
		const parsed = new URL(
			trimmed.includes("://") ? trimmed : `ws://${trimmed}`,
		);
		return {
			host: parsed.hostname || undefined,
			port: parsed.port ? Number(parsed.port) : undefined,
			pathname:
				parsed.pathname && parsed.pathname !== "/"
					? parsed.pathname
					: undefined,
		};
	} catch {
		return {};
	}
}

export async function ensureCliHubServer(
	workspaceRoot: string,
	endpoint: HubEndpointOverrides = {},
): Promise<DetachedHubResolution> {
	return await ensureDetachedHubServer(workspaceRoot, endpoint);
}
