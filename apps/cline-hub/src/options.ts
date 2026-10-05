import { isIP } from "node:net";

/**
 * An already-running hub the dashboard attaches to instead of discovering or
 * spawning its own managed local hub. The dashboard never stops, restarts, or
 * retires an external hub: it is owned by whatever process started it.
 */
export interface ExternalHubEndpoint {
	url: string;
	authToken?: string;
}

export interface ClineHubServerOptions {
	host: string;
	port: number;
	publicUrl: string;
	roomSecret?: string;
	workspaceRoot: string;
	externalHub?: ExternalHubEndpoint;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DASHBOARD_PORT_ENV = "CLINE_HUB_DASHBOARD_PORT";
const EXTERNAL_HUB_URL_ENV = "CLINE_HUB_ENDPOINT";
const EXTERNAL_HUB_AUTH_TOKEN_ENV = "CLINE_HUB_AUTH_TOKEN";

function parsePort(value: string | undefined): number {
	if (!value?.trim()) return DEFAULT_PORT;
	const port = Number.parseInt(value, 10);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(
			`${DASHBOARD_PORT_ENV} must be an integer from 1 to 65535, got ${value}`,
		);
	}
	return port;
}

function normalizeHost(value: string | undefined): string {
	return value?.trim() || DEFAULT_HOST;
}

function normalizePublicUrl(
	value: string | undefined,
	host: string,
	port: number,
): string {
	const fallbackHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
	const raw = value?.trim() || `http://${fallbackHost}:${port}`;
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch (error) {
		throw new Error(
			`PUBLIC_URL must be a valid http(s) URL, got ${raw}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(
			`PUBLIC_URL must use http: or https:, got ${parsed.protocol}`,
		);
	}
	if (shouldAddDashboardPortToPublicUrl(parsed, port)) {
		parsed.port = String(port);
	}
	parsed.hash = "";
	return parsed.toString().replace(/\/$/, "");
}

function normalizeRoomSecret(value: string | undefined): string | undefined {
	const secret = value?.trim();
	return secret ? secret : undefined;
}

function normalizeExternalHubUrl(raw: string): string {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch (error) {
		throw new Error(
			`${EXTERNAL_HUB_URL_ENV} must be a valid ws(s) or http(s) URL, got ${raw}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (parsed.protocol === "http:") parsed.protocol = "ws:";
	else if (parsed.protocol === "https:") parsed.protocol = "wss:";
	if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
		throw new Error(
			`${EXTERNAL_HUB_URL_ENV} must use ws:, wss:, http:, or https:, got ${parsed.protocol}`,
		);
	}
	// A hub bound to a wildcard address advertises it in its URL; connect to
	// the matching loopback address instead.
	if (parsed.hostname === "0.0.0.0") parsed.hostname = "127.0.0.1";
	else if (parsed.hostname === "[::]") parsed.hostname = "[::1]";
	if (parsed.pathname === "/" || parsed.pathname === "") {
		parsed.pathname = "/hub";
	}
	parsed.hash = "";
	return parsed.toString();
}

function resolveExternalHub(
	env: NodeJS.ProcessEnv,
): ExternalHubEndpoint | undefined {
	const rawUrl = env[EXTERNAL_HUB_URL_ENV]?.trim();
	const authToken = env[EXTERNAL_HUB_AUTH_TOKEN_ENV]?.trim() || undefined;
	if (!rawUrl) {
		if (authToken) {
			throw new Error(
				`${EXTERNAL_HUB_AUTH_TOKEN_ENV} requires ${EXTERNAL_HUB_URL_ENV} to be set.`,
			);
		}
		return undefined;
	}
	return { url: normalizeExternalHubUrl(rawUrl), authToken };
}

function isLocalBindHost(host: string): boolean {
	return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function isNonLocalBindHost(host: string): boolean {
	return !isLocalBindHost(host);
}

export function resolveClineHubServerOptions(
	env: NodeJS.ProcessEnv = process.env,
): ClineHubServerOptions {
	const host = normalizeHost(env.HOST);
	const port = parsePort(env[DASHBOARD_PORT_ENV]);
	const publicUrl = normalizePublicUrl(env.PUBLIC_URL, host, port);
	const roomSecret = normalizeRoomSecret(env.ROOM_SECRET);
	if (isNonLocalBindHost(host) && !roomSecret) {
		throw new Error(
			`ROOM_SECRET is required when HOST=${host}. Use HOST=127.0.0.1 for local-only development or set ROOM_SECRET before exposing this example on a LAN/tunnel.`,
		);
	}
	return {
		host,
		port,
		publicUrl,
		roomSecret,
		workspaceRoot: env.WORKSPACE_ROOT?.trim() || process.cwd(),
		externalHub: resolveExternalHub(env),
	};
}

function isDefaultProtocolPort(url: URL, port: number): boolean {
	return (
		(url.protocol === "http:" && port === 80) ||
		(url.protocol === "https:" && port === 443)
	);
}

function shouldAddDashboardPortToPublicUrl(url: URL, port: number): boolean {
	if (url.port || isDefaultProtocolPort(url, port)) return false;
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	return hostname === "localhost" || isIP(hostname) !== 0;
}

export function buildInviteUrl(
	publicUrl: string,
	roomSecret: string | undefined,
): string {
	const url = new URL(publicUrl);
	if (roomSecret) {
		url.searchParams.set("roomSecret", roomSecret);
	}
	return url.toString();
}
