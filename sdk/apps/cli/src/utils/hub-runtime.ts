import {
	ensureDetachedHubServer,
	type HubEndpointOverrides,
	prewarmDetachedHubServer,
} from "@clinebot/core";

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

export function prewarmCliHubServer(
	workspaceRoot: string,
	endpoint: HubEndpointOverrides = {},
): void {
	prewarmDetachedHubServer(workspaceRoot, endpoint);
}

export async function ensureCliHubServer(
	workspaceRoot: string,
	endpoint: HubEndpointOverrides = {},
): Promise<string> {
	return await ensureDetachedHubServer(workspaceRoot, endpoint);
}
