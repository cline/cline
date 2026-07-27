import { isNonLocalBindHost } from "../options";

export interface BrowserRequestAuthOptions {
	bindHost: string;
	port: number;
	publicUrl: string;
	roomSecret?: string;
}

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type PublicBrowserRoutePredicate = (req: Request, url: URL) => boolean;

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

function formatHostForOrigin(host: string): string {
	return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function isDefaultProtocolPort(protocol: string, port: number): boolean {
	return (
		(protocol === "http:" && port === 80) ||
		(protocol === "https:" && port === 443)
	);
}

function originForHost(protocol: string, host: string, port: number): string {
	return new URL(`${protocol}//${formatHostForOrigin(host)}:${port}`).origin;
}

function hostHeaderForHost(
	protocol: string,
	host: string,
	port: number,
): string {
	const formattedHost = formatHostForOrigin(host).toLowerCase();
	return isDefaultProtocolPort(protocol, port)
		? formattedHost
		: `${formattedHost}:${port}`;
}

export function allowedBrowserOrigins({
	bindHost,
	port,
	publicUrl,
}: BrowserRequestAuthOptions): Set<string> {
	const publicUrlParts = new URL(publicUrl);
	const origins = new Set<string>();
	origins.add(publicUrlParts.origin);

	origins.add(originForHost(publicUrlParts.protocol, bindHost, port));

	if (!isNonLocalBindHost(bindHost)) {
		for (const hostname of ["127.0.0.1", "localhost", "[::1]"]) {
			origins.add(originForHost(publicUrlParts.protocol, hostname, port));
		}
	}

	return origins;
}

export function allowedBrowserHosts({
	bindHost,
	port,
	publicUrl,
}: BrowserRequestAuthOptions): Set<string> {
	const publicUrlParts = new URL(publicUrl);
	const hosts = new Set<string>();
	const publicHost = publicUrlParts.host.toLowerCase();
	hosts.add(publicHost);

	hosts.add(hostHeaderForHost(publicUrlParts.protocol, bindHost, port));

	if (!isNonLocalBindHost(bindHost)) {
		for (const hostname of ["127.0.0.1", "localhost", "[::1]"]) {
			hosts.add(hostHeaderForHost(publicUrlParts.protocol, hostname, port));
		}
	}

	return hosts;
}

export function requiresBrowserRequestAuth(
	req: Request,
	url: URL,
	isPublicBrowserRoute: PublicBrowserRoutePredicate,
): boolean {
	if (isWebSocketUpgrade(req)) return true;
	if (!SAFE_HTTP_METHODS.has(req.method.toUpperCase())) return true;
	return !isPublicBrowserRoute(req, url);
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
	isPublicBrowserRoute: PublicBrowserRoutePredicate,
): boolean {
	return (
		!requiresBrowserRequestAuth(req, url, isPublicBrowserRoute) ||
		isAuthorizedBrowserRequest(req, url, options)
	);
}
