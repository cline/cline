import { randomBytes } from "node:crypto";

export interface ClineHubServerOptions {
	host: string;
	port: number;
	publicUrl: string;
	dashboardWebUrl: string;
	roomSecret?: string;
	workspaceRoot: string;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DASHBOARD_PORT_ENV = "CLINE_HUB_DASHBOARD_PORT";
const DASHBOARD_WEB_URL_ENV = "CLINE_HUB_DASHBOARD_WEB_URL";

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
	parsed.hash = "";
	return parsed.toString().replace(/\/$/, "");
}

function normalizeDashboardWebUrl(
	value: string | undefined,
	publicUrl: string,
): string {
	const raw = value?.trim() || publicUrl;
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch (error) {
		throw new Error(
			`${DASHBOARD_WEB_URL_ENV} must be a valid http(s) URL, got ${raw}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(
			`${DASHBOARD_WEB_URL_ENV} must use http: or https:, got ${parsed.protocol}`,
		);
	}
	parsed.hash = "";
	return parsed.toString().replace(/\/$/, "");
}

function normalizeRoomSecret(value: string | undefined): string | undefined {
	const secret = value?.trim();
	return secret ? secret : randomBytes(32).toString("hex");
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
	const dashboardWebUrl = normalizeDashboardWebUrl(
		env[DASHBOARD_WEB_URL_ENV],
		publicUrl,
	);
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
		dashboardWebUrl,
		roomSecret,
		workspaceRoot: env.WORKSPACE_ROOT?.trim() || process.cwd(),
	};
}

export function buildDashboardLaunchUrl(
	dashboardWebUrl: string,
	bridgeUrl: string,
	roomSecret: string | undefined,
	hubUrl?: string,
): string {
	const url = new URL(dashboardWebUrl);
	const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
	fragment.set("bridgeUrl", bridgeUrl);
	if (roomSecret) {
		fragment.set("roomSecret", roomSecret);
	}
	if (hubUrl) {
		fragment.set("hubUrl", hubUrl);
	}
	url.hash = fragment.toString();
	return url.toString();
}
