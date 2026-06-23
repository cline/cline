import { describe, expect, it } from "vitest";
import {
	allowedBrowserHosts,
	allowedBrowserOrigins,
	isAuthorizedBrowserRequest,
	isAuthorizedBrowserToDesktopRequest,
	requiresBrowserRequestAuth,
} from "./browser-auth";

const defaultOptions = {
	bindHost: "127.0.0.1",
	port: 8787,
	publicUrl: "http://127.0.0.1:8787",
};

const publicRoute = (_req: Request, url: URL) => url.pathname === "/public";

function browserRequest(
	origin?: string,
	init?: Omit<RequestInit, "headers"> & {
		headers?: Record<string, string>;
	},
): Request {
	return new Request("http://127.0.0.1:8787/browser", {
		...init,
		headers: {
			host: "127.0.0.1:8787",
			...(origin === undefined ? {} : { origin }),
			...(init?.headers ?? {}),
		},
	});
}

describe("allowedBrowserOrigins", () => {
	it("allows the configured public URL origin and local aliases for local binds", () => {
		expect([...allowedBrowserOrigins(defaultOptions)].sort()).toEqual([
			"http://127.0.0.1:8787",
			"http://[::1]:8787",
			"http://localhost:8787",
		]);
	});

	it("uses the configured public URL scheme for local aliases", () => {
		expect(
			[
				...allowedBrowserOrigins({
					...defaultOptions,
					publicUrl: "https://127.0.0.1:8787",
				}),
			].sort(),
		).toEqual([
			"https://127.0.0.1:8787",
			"https://[::1]:8787",
			"https://localhost:8787",
		]);
	});

	it("allows the configured public URL origin and explicit bind origin for non-local binds", () => {
		expect(
			[
				...allowedBrowserOrigins({
					bindHost: "0.0.0.0",
					port: 8787,
					publicUrl: "https://example.ngrok-free.app",
					roomSecret: "secret",
				}),
			].sort(),
		).toEqual(["https://0.0.0.0:8787", "https://example.ngrok-free.app"]);
	});
});

describe("allowedBrowserHosts", () => {
	it("allows the configured public URL host and local aliases for local binds", () => {
		expect([...allowedBrowserHosts(defaultOptions)].sort()).toEqual([
			"127.0.0.1:8787",
			"[::1]:8787",
			"localhost:8787",
		]);
	});

	it("allows the configured public URL host and explicit bind host for non-local binds", () => {
		expect(
			[
				...allowedBrowserHosts({
					bindHost: "0.0.0.0",
					port: 8787,
					publicUrl: "https://example.ngrok-free.app",
					roomSecret: "secret",
				}),
			].sort(),
		).toEqual(["0.0.0.0:8787", "example.ngrok-free.app"]);
	});
});

describe("requiresBrowserRequestAuth", () => {
	it("does not require browser auth for public GET routes", () => {
		expect(
			requiresBrowserRequestAuth(
				new Request("http://127.0.0.1:8787/public"),
				new URL("http://127.0.0.1:8787/public"),
				publicRoute,
			),
		).toBe(false);
	});

	it("requires browser auth for unknown paths even when they use GET", () => {
		expect(
			requiresBrowserRequestAuth(
				new Request("http://127.0.0.1:8787/future-api"),
				new URL("http://127.0.0.1:8787/future-api"),
				publicRoute,
			),
		).toBe(true);
	});

	it("requires browser auth for privileged paths even when they use GET", () => {
		expect(
			requiresBrowserRequestAuth(
				new Request("http://127.0.0.1:8787/browser"),
				new URL("http://127.0.0.1:8787/browser"),
				publicRoute,
			),
		).toBe(true);
	});

	it("requires browser auth for every WebSocket upgrade path", () => {
		expect(
			requiresBrowserRequestAuth(
				new Request("http://127.0.0.1:8787/future-socket", {
					headers: { upgrade: "websocket" },
				}),
				new URL("http://127.0.0.1:8787/future-socket"),
				publicRoute,
			),
		).toBe(true);
	});

	it("requires browser auth for every unsafe HTTP method", () => {
		expect(
			requiresBrowserRequestAuth(
				new Request("http://127.0.0.1:8787/future-api", { method: "POST" }),
				new URL("http://127.0.0.1:8787/future-api"),
				publicRoute,
			),
		).toBe(true);
	});
});

describe("isAuthorizedBrowserRequest", () => {
	it.each([
		"http://127.0.0.1:8787",
		"http://localhost:8787",
		"http://[::1]:8787",
	])("accepts local dashboard origin %s without a room secret", (origin) => {
		expect(
			isAuthorizedBrowserRequest(
				browserRequest(origin),
				new URL("http://127.0.0.1:8787/browser"),
				defaultOptions,
			),
		).toBe(true);
	});

	it.each([
		undefined,
		"",
		"null",
		"not a url",
		"http://evil.attacker.example.com",
		"http://127.0.0.1:9999",
		"https://127.0.0.1:8787",
	])("rejects untrusted origin %s", (origin) => {
		expect(
			isAuthorizedBrowserRequest(
				browserRequest(origin),
				new URL("http://127.0.0.1:8787/browser"),
				defaultOptions,
			),
		).toBe(false);
	});

	it.each([
		undefined,
		"",
		"evil.attacker.example.com",
		"127.0.0.1:9999",
		"localhost:9999",
	])("rejects untrusted host %s", (host) => {
		expect(
			isAuthorizedBrowserRequest(
				browserRequest("http://127.0.0.1:8787", {
					headers: host === undefined ? { host: "" } : { host },
				}),
				new URL("http://127.0.0.1:8787/browser"),
				defaultOptions,
			),
		).toBe(false);
	});

	it("allows explicit wildcard bind host and origin when a room secret is configured", () => {
		expect(
			isAuthorizedBrowserRequest(
				browserRequest("http://0.0.0.0:8787", {
					headers: { host: "0.0.0.0:8787" },
				}),
				new URL("http://0.0.0.0:8787/browser?roomSecret=invite-123"),
				{
					bindHost: "0.0.0.0",
					port: 8787,
					publicUrl: "http://127.0.0.1:8787",
					roomSecret: "invite-123",
				},
			),
		).toBe(true);
	});

	it("requires trusted origin, trusted host, and room secret when a room secret is configured", () => {
		const options = { ...defaultOptions, roomSecret: "invite-123" };

		expect(
			isAuthorizedBrowserRequest(
				browserRequest("http://127.0.0.1:8787"),
				new URL("http://127.0.0.1:8787/browser?roomSecret=invite-123"),
				options,
			),
		).toBe(true);
		expect(
			isAuthorizedBrowserRequest(
				browserRequest("http://127.0.0.1:8787"),
				new URL("http://127.0.0.1:8787/browser"),
				options,
			),
		).toBe(false);
		expect(
			isAuthorizedBrowserRequest(
				browserRequest("http://evil.attacker.example.com"),
				new URL("http://127.0.0.1:8787/browser?roomSecret=invite-123"),
				options,
			),
		).toBe(false);
		expect(
			isAuthorizedBrowserRequest(
				browserRequest("http://127.0.0.1:8787", {
					headers: { host: "evil.attacker.example.com" },
				}),
				new URL("http://127.0.0.1:8787/browser?roomSecret=invite-123"),
				options,
			),
		).toBe(false);
	});
});

describe("isAuthorizedBrowserToDesktopRequest", () => {
	it("allows safe public GET routes without an origin", () => {
		expect(
			isAuthorizedBrowserToDesktopRequest(
				new Request("http://127.0.0.1:8787/public"),
				new URL("http://127.0.0.1:8787/public"),
				defaultOptions,
				publicRoute,
			),
		).toBe(true);
	});

	it("rejects future WebSocket paths from untrusted origins by default", () => {
		expect(
			isAuthorizedBrowserToDesktopRequest(
				new Request("http://127.0.0.1:8787/future-socket", {
					headers: {
						host: "127.0.0.1:8787",
						origin: "http://evil.attacker.example.com",
						upgrade: "websocket",
					},
				}),
				new URL("http://127.0.0.1:8787/future-socket"),
				defaultOptions,
				publicRoute,
			),
		).toBe(false);
	});

	it("rejects future unsafe HTTP routes from untrusted origins by default", () => {
		expect(
			isAuthorizedBrowserToDesktopRequest(
				new Request("http://127.0.0.1:8787/future-api", {
					method: "POST",
					headers: {
						host: "127.0.0.1:8787",
						origin: "http://evil.attacker.example.com",
					},
				}),
				new URL("http://127.0.0.1:8787/future-api"),
				defaultOptions,
				publicRoute,
			),
		).toBe(false);
	});

	it("allows future unsafe HTTP routes from trusted origins", () => {
		expect(
			isAuthorizedBrowserToDesktopRequest(
				new Request("http://127.0.0.1:8787/future-api", {
					method: "POST",
					headers: {
						host: "127.0.0.1:8787",
						origin: "http://127.0.0.1:8787",
					},
				}),
				new URL("http://127.0.0.1:8787/future-api"),
				defaultOptions,
				publicRoute,
			),
		).toBe(true);
	});
});
