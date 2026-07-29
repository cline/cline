import { isIP } from "node:net";

import {
	type BoundedOutboundChannelOptions,
	resolveResourcePolicy,
} from "@cline/core";

export interface ClineHubServerOptions {
	host: string;
	port: number;
	/** True when `CLINE_HUB_DASHBOARD_PORT` was set — do not silently relocate. */
	portExplicit: boolean;
	publicUrl: string;
	/** True when `PUBLIC_URL` was set — keep it even if the listen port moves. */
	publicUrlExplicit: boolean;
	roomSecret?: string;
	workspaceRoot: string;
	maxInboundPayloadBytes: number;
	websocketDelivery: BoundedOutboundChannelOptions;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DASHBOARD_PORT_ENV = "CLINE_HUB_DASHBOARD_PORT";
const DEFAULT_MAX_INBOUND_PAYLOAD_BYTES = 1024 * 1024;

function parsePositiveBytes(
	value: string | undefined,
	fallback: number,
	name: string,
): number {
	if (!value?.trim()) return fallback;
	const bytes = Number(value);
	if (!Number.isSafeInteger(bytes) || bytes <= 0) {
		throw new Error(`${name} must be a positive integer, got ${value}`);
	}
	return bytes;
}

function parsePort(
	value: string | undefined,
): { port: number; explicit: boolean } {
	if (!value?.trim()) return { port: DEFAULT_PORT, explicit: false };
	const port = Number.parseInt(value, 10);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(
			`${DASHBOARD_PORT_ENV} must be an integer from 1 to 65535, got ${value}`,
		);
	}
	return { port, explicit: true };
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
	const { port, explicit: portExplicit } = parsePort(env[DASHBOARD_PORT_ENV]);
	const publicUrlExplicit = Boolean(env.PUBLIC_URL?.trim());
	const publicUrl = normalizePublicUrl(env.PUBLIC_URL, host, port);
	const roomSecret = normalizeRoomSecret(env.ROOM_SECRET);
	const resourcePolicy = resolveResourcePolicy({ env });
	const websocketPolicy = resourcePolicy.profile.transport.websocket;
	if (isNonLocalBindHost(host) && !roomSecret) {
		throw new Error(
			`ROOM_SECRET is required when HOST=${host}. Use HOST=127.0.0.1 for local-only development or set ROOM_SECRET before exposing this example on a LAN/tunnel.`,
		);
	}
	const hardWatermarkBytes = parsePositiveBytes(
		env.CLINE_HUB_WS_HARD_WATERMARK_BYTES,
		websocketPolicy.hardWatermarkBytes,
		"CLINE_HUB_WS_HARD_WATERMARK_BYTES",
	);
	const softWatermarkBytes = parsePositiveBytes(
		env.CLINE_HUB_WS_SOFT_WATERMARK_BYTES,
		websocketPolicy.softWatermarkBytes,
		"CLINE_HUB_WS_SOFT_WATERMARK_BYTES",
	);
	if (softWatermarkBytes > hardWatermarkBytes) {
		throw new Error("WebSocket soft watermark cannot exceed hard watermark");
	}
	return {
		host,
		port,
		portExplicit,
		publicUrl,
		publicUrlExplicit,
		roomSecret,
		workspaceRoot: env.WORKSPACE_ROOT?.trim() || process.cwd(),
		maxInboundPayloadBytes: parsePositiveBytes(
			env.CLINE_HUB_WS_MAX_INBOUND_PAYLOAD_BYTES,
			websocketPolicy.maxInboundPayloadBytes ??
				DEFAULT_MAX_INBOUND_PAYLOAD_BYTES,
			"CLINE_HUB_WS_MAX_INBOUND_PAYLOAD_BYTES",
		),
		websocketDelivery: {
			softWatermarkBytes,
			hardWatermarkBytes,
			congestionGraceMs: websocketPolicy.congestionGraceMs,
			closeGraceMs: websocketPolicy.closeGraceMs,
		},
	};
}

/**
 * When the dashboard falls back to another listen port, rewrite an auto-derived
 * public URL so invite links and browser auth stay on the live origin. Leave an
 * explicit `PUBLIC_URL` alone (tunnels, reverse proxies).
 */
export function rebasePublicUrlForListenPort(
	options: Pick<
		ClineHubServerOptions,
		"host" | "port" | "publicUrl" | "publicUrlExplicit"
	>,
	listenPort: number,
): string {
	if (options.publicUrlExplicit || listenPort === options.port) {
		return options.publicUrl;
	}
	return normalizePublicUrl(undefined, options.host, listenPort);
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
