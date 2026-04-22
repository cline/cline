const HUB_HOST_ENV = "CLINE_HUB_HOST";
const HUB_PORT_ENV = "CLINE_HUB_PORT";
const HUB_PATHNAME_ENV = "CLINE_HUB_PATHNAME";

export const DEFAULT_HUB_HOST = "127.0.0.1";
export const DEFAULT_HUB_PORT = 4319;
export const DEFAULT_HUB_PATHNAME = "/hub";

export interface HubEndpointOverrides {
	host?: string;
	port?: number;
	pathname?: string;
}

export function resolveDefaultHubHost(): string {
	return process.env[HUB_HOST_ENV]?.trim() || DEFAULT_HUB_HOST;
}

export function resolveDefaultHubPort(): number {
	const raw = process.env[HUB_PORT_ENV]?.trim();
	if (!raw) {
		return DEFAULT_HUB_PORT;
	}
	const port = Number.parseInt(raw, 10);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		return DEFAULT_HUB_PORT;
	}
	return port;
}

export function resolveDefaultHubPathname(): string {
	return process.env[HUB_PATHNAME_ENV]?.trim() || DEFAULT_HUB_PATHNAME;
}

export function resolveHubEndpointOptions(
	overrides: HubEndpointOverrides = {},
): Required<HubEndpointOverrides> {
	return {
		host: overrides.host ?? resolveDefaultHubHost(),
		port: overrides.port ?? resolveDefaultHubPort(),
		pathname: overrides.pathname ?? resolveDefaultHubPathname(),
	};
}
