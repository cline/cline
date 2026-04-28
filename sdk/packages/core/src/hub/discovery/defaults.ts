import {
	CLINE_HUB_DEV_PORT,
	CLINE_HUB_PORT,
	resolveClineBuildEnv,
} from "@clinebot/shared";

const HUB_HOST_ENV = "CLINE_HUB_HOST";
const HUB_PORT_ENV = "CLINE_HUB_PORT";
const HUB_PATHNAME_ENV = "CLINE_HUB_PATHNAME";

export const DEFAULT_HUB_HOST = "127.0.0.1";
export const DEFAULT_HUB_PORT = CLINE_HUB_PORT;
export const DEFAULT_HUB_PATHNAME = "/hub";

export interface HubEndpointOverrides {
	host?: string;
	port?: number;
	pathname?: string;
}

export interface ResolveHubDefaultsOptions {
	env?: NodeJS.ProcessEnv;
	execArgv?: string[];
}

function fallbackHubPort(options: ResolveHubDefaultsOptions): number {
	return resolveClineBuildEnv(options) === "development"
		? CLINE_HUB_DEV_PORT
		: DEFAULT_HUB_PORT;
}

export function resolveDefaultHubHost(
	options: ResolveHubDefaultsOptions = {},
): string {
	const env = options.env ?? process.env;
	return env[HUB_HOST_ENV]?.trim() || DEFAULT_HUB_HOST;
}

export function resolveDefaultHubPort(
	options: ResolveHubDefaultsOptions = {},
): number {
	const env = options.env ?? process.env;
	const raw = env[HUB_PORT_ENV]?.trim();
	if (!raw) {
		return fallbackHubPort(options);
	}
	const port = Number.parseInt(raw, 10);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		return fallbackHubPort(options);
	}
	return port;
}

export function resolveDefaultHubPathname(
	options: ResolveHubDefaultsOptions = {},
): string {
	const env = options.env ?? process.env;
	return env[HUB_PATHNAME_ENV]?.trim() || DEFAULT_HUB_PATHNAME;
}

export function resolveHubEndpointOptions(
	overrides: HubEndpointOverrides = {},
	options: ResolveHubDefaultsOptions = {},
): Required<HubEndpointOverrides> {
	return {
		host: overrides.host ?? resolveDefaultHubHost(options),
		port: overrides.port ?? resolveDefaultHubPort(options),
		pathname: overrides.pathname ?? resolveDefaultHubPathname(options),
	};
}
