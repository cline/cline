import { isNonLocalBindHost } from "../options";

export interface BrowserRequestAuthOptions {
	bindHost: string;
	port: number;
	publicUrl: string;
	roomSecret?: string;
}

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Browser-to-desktop routes must be origin-gated by default. This catches future
// WebSocket endpoints and unsafe HTTP APIs automatically; add any privileged
// safe-method paths here so they cannot bypass Origin/room-secret checks.
const PRIVILEGED_BROWSER_PATHS = new Set(["/browser"]);

function isWebSocketUpgrade(req: Request): boolean {
	return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

function parseOrigin(value: string | null): string | undefined {
	const origin = parseHeader(value);
	try {
		return new URL(origin ?? "").origin;
	} catch {
		return undefined;
	}
}

function parseHeader(value: string | null): string | undefined {
	const host = value?.trim().toLowerCase();
	return host || undefined;
}

export function allowedBrowserOrigins({
	bindHost,
	port,
	publicUrl,
}: BrowserRequestAuthOptions): Set<string> {
	const origins = new Set<string>();
	origins.add(new URL(publicUrl).origin);

	if (!isNonLocalBindHost(bindHost)) {
		for (const hostname of ["127.0.0.1", "localhost", "[::1]"]) {
			origins.add(`http://${hostname}:${port}`);
		}
	}

	return origins;
}

export function allowedBrowserHosts({
	bindHost,
	port,
	publicUrl,
}: BrowserRequestAuthOptions): Set<string> {
	const hosts = new Set<string>();
	const publicHost = new URL(publicUrl).host.toLowerCase();
	hosts.add(publicHost);

	if (!isNonLocalBindHost(bindHost)) {
		for (const hostname of ["127.0.0.1", "localhost", "[::1]"]) {
			hosts.add(`${hostname}:${port}`);
		}
	}

	return hosts;
}

export function requiresBrowserRequestAuth(req: Request, url: URL): boolean {
	return (
		isWebSocketUpgrade(req) ||
		!SAFE_HTTP_METHODS.has(req.method.toUpperCase()) ||
		PRIVILEGED_BROWSER_PATHS.has(url.pathname)
	);
}

export function isAuthorizedBrowserRequest(
	req: Request,
	url: URL,
	options: BrowserRequestAuthOptions,
): boolean {
	const host = parseHeader(req.headers.get("host"));
	if (!host || !allowedBrowserHosts(options).has(host)) return false;

	const origin = parseOrigin(req.headers.get("origin"));
	if (!origin || !allowedBrowserOrigins(options).has(origin)) return false;

	if (!options.roomSecret) return true;
	return url.searchParams.get("roomSecret") === options.roomSecret;
}

export function isAuthorizedBrowserToDesktopRequest(
	req: Request,
	url: URL,
	options: BrowserRequestAuthOptions,
): boolean {
	return (
		!requiresBrowserRequestAuth(req, url) ||
		isAuthorizedBrowserRequest(req, url, options)
	);
}
