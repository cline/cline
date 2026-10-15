import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, it } from "vitest";
import { authorizeMcpServerOAuth } from "./oauth";

const resource = "https://mcp.example.test/mcp";
const issuer = "https://auth.example.test";

describe("explicit MCP OAuth authorization", () => {
	const roots: string[] = [];
	afterEach(async () => {
		await Promise.all(
			roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
		);
	});

	async function fixture(
		config: {
			headers?: Record<string, string>;
			redirect?: "register" | "token";
		} = {},
	) {
		const root = await mkdtemp(join(tmpdir(), "mcp-authorization-"));
		roots.push(root);
		const filePath = join(root, "settings.json");
		await writeFile(
			filePath,
			JSON.stringify({
				mcpServers: {
					remote: {
						type: "streamableHttp",
						url: resource,
						headers: config.headers,
					},
				},
			}),
		);
		const portServer = createServer();
		await new Promise<void>((resolve) =>
			portServer.listen(0, "127.0.0.1", resolve),
		);
		const address = portServer.address();
		if (!address || typeof address === "string")
			throw new Error("Missing callback port");
		const port = address.port;
		await new Promise<void>((resolve) => portServer.close(() => resolve()));
		let releaseMetadata!: () => void;
		let metadataStarted!: () => void;
		const metadataGate = new Promise<void>((resolve) => {
			releaseMetadata = resolve;
		});
		const metadataRequested = new Promise<void>((resolve) => {
			metadataStarted = resolve;
		});
		let challenge = "";
		let tokenExchanges = 0;
		let refreshes = 0;
		let opened = 0;
		let closed = 0;
		let escaped = 0;
		let gatewayRequests = 0;
		const fetchFixture: FetchLike = async (input, init) => {
			const url = new URL(
				input instanceof Request ? input.url : input.toString(),
			);
			const json = (value: unknown, status = 200) =>
				new Response(JSON.stringify(value), {
					status,
					headers: { "content-type": "application/json" },
				});
			const headers = new Headers(
				init?.headers ?? (input instanceof Request ? input.headers : undefined),
			);
			if (url.origin === "https://redirect.example.test") {
				escaped++;
				throw new Error("Cross-origin redirect reached destination");
			}
			if (config.headers) {
				if (url.origin === new URL(resource).origin) {
					expect(headers.get("x-tenant")).toBe("fixture-tenant");
					gatewayRequests++;
				} else {
					expect(headers.has("x-tenant")).toBe(false);
				}
			}
			if (url.pathname === "/register" || url.pathname === "/token") {
				expect(headers.get("content-type")).toBe(
					url.pathname === "/register"
						? "application/json"
						: "application/x-www-form-urlencoded",
				);
				if (url.pathname === `/${config.redirect}`) {
					expect(init?.redirect).toBe("manual");
					return new Response(null, {
						status: 307,
						headers: { location: "https://redirect.example.test/receive" },
					});
				}
			}
			if (url.pathname.includes("oauth-protected-resource"))
				return json({ resource, authorization_servers: [issuer] });
			if (url.origin === issuer && url.pathname.includes(".well-known")) {
				metadataStarted();
				await metadataGate;
				return json({
					issuer,
					authorization_endpoint: `${issuer}/authorize`,
					token_endpoint: `${issuer}/token`,
					registration_endpoint: `${issuer}/register`,
					response_types_supported: ["code"],
					code_challenge_methods_supported: ["S256"],
					token_endpoint_auth_methods_supported: ["none"],
				});
			}
			if (url.pathname === "/register")
				return json({
					client_id: "fixture-client",
					...JSON.parse(String(init?.body)),
				});
			if (url.pathname === "/token") {
				const body = new URLSearchParams(String(init?.body));
				if (body.get("grant_type") === "refresh_token") {
					expect(body.get("refresh_token")).toBe("fixture-refresh");
					refreshes++;
				} else {
					expect(body.get("code")).toBe("fixture-code");
					expect(
						createHash("sha256")
							.update(body.get("code_verifier") ?? "")
							.digest("base64url"),
					).toBe(challenge);
					tokenExchanges++;
				}
				return json({
					access_token: "fixture-access",
					refresh_token: "fixture-refresh",
					token_type: "Bearer",
					expires_in: 3600,
				});
			}
			if (url.href === resource && init?.method === "GET") {
				if (new Headers(init.headers).has("authorization"))
					return new Response(null, { status: 405 });
				return new Response(null, {
					status: 401,
					headers: {
						"www-authenticate": `Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"`,
					},
				});
			}
			if (url.href === resource && init?.method === "POST") {
				const body = JSON.parse(String(init.body));
				if (body.id === undefined) return new Response(null, { status: 202 });
				return json({
					jsonrpc: "2.0",
					id: body.id,
					result:
						body.method === "initialize"
							? {
									protocolVersion: "2024-11-05",
									capabilities: { tools: {} },
									serverInfo: { name: "fixture", version: "1" },
								}
							: { tools: [] },
				});
			}
			throw new Error(
				`Unexpected fixture request ${url.origin}${url.pathname}`,
			);
		};
		return {
			filePath,
			port,
			fetchFixture,
			releaseMetadata,
			metadataRequested,
			counts: () => ({ tokenExchanges, refreshes, opened, closed }),
			headerCounts: () => ({ escaped, gatewayRequests }),
			options: {
				serverName: "remote",
				filePath,
				callbackPorts: [port],
				timeoutMs: 3000,
				fetch: fetchFixture,
				onServerClose: () => {
					closed++;
				},
				openUrl: async (raw: string) => {
					opened++;
					const url = new URL(raw);
					challenge = url.searchParams.get("code_challenge") ?? "";
					const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
					// A live native callback listener must survive delayed discovery.
					expect((await fetch(new URL("/probe", callback))).status).toBe(404);
					callback.searchParams.set("code", "fixture-code");
					callback.searchParams.set(
						"state",
						url.searchParams.get("state") ?? "",
					);
					expect((await fetch(callback)).status).toBe(200);
				},
			},
		};
	}

	it("awaits delayed OAuth discovery even when anonymous MCP discovery succeeds", async () => {
		const f = await fixture();
		const result = authorizeMcpServerOAuth(f.options);
		try {
			await f.metadataRequested;
			const settled = await Promise.race([
				result.then(() => true),
				new Promise<boolean>((resolve) => setImmediate(() => resolve(false))),
			]);
			expect(settled).toBe(false);
			f.releaseMetadata();
			await expect(result).resolves.toMatchObject({ authorized: true });
			expect(f.counts()).toEqual({
				tokenExchanges: 1,
				refreshes: 0,
				opened: 1,
				closed: 1,
			});
			await expect(authorizeMcpServerOAuth(f.options)).resolves.toMatchObject({
				authorized: true,
			});
			expect(f.counts()).toEqual({
				tokenExchanges: 1,
				refreshes: 1,
				opened: 1,
				closed: 2,
			});
		} finally {
			f.releaseMetadata();
			await result.catch(() => {});
		}
	});

	it("requires configured gateway headers only on the MCP origin", async () => {
		const f = await fixture({
			headers: {
				"X-Tenant": "fixture-tenant",
				"Content-Type": "application/vnd.gateway+json",
			},
		});
		f.releaseMetadata();
		await expect(authorizeMcpServerOAuth(f.options)).resolves.toMatchObject({
			authorized: true,
		});
		expect(f.counts()).toMatchObject({
			tokenExchanges: 1,
			opened: 1,
			closed: 1,
		});
		expect(f.headerCounts().gatewayRequests).toBeGreaterThan(1);
		await expect(authorizeMcpServerOAuth(f.options)).resolves.toMatchObject({
			authorized: true,
		});
		expect(f.counts().refreshes).toBe(1);
	});

	it.each(["register", "token"] as const)(
		"rejects cross-origin %s redirects without forwarding requests",
		async (redirect) => {
			const f = await fixture({
				headers: { "X-Tenant": "fixture-tenant" },
				redirect,
			});
			f.releaseMetadata();
			await expect(authorizeMcpServerOAuth(f.options)).rejects.toThrow();
			expect(f.headerCounts().escaped).toBe(0);
			expect(f.counts().closed).toBe(1);
		},
	);

	it("cancels delayed metadata discovery and closes the callback listener", async () => {
		const f = await fixture();
		const controller = new AbortController();
		let markStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const result = authorizeMcpServerOAuth({
			...f.options,
			signal: controller.signal,
			fetch: async (_input, init) => {
				markStarted();
				if (init?.signal?.aborted) throw init.signal.reason;
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(init.signal?.reason),
						{ once: true },
					);
				});
			},
		});
		await started;
		controller.abort();
		await expect(result).rejects.toThrow("cancelled");
		expect(f.counts()).toMatchObject({
			tokenExchanges: 0,
			opened: 0,
			closed: 1,
		});
	});

	it("cleans up when OAuth metadata cannot be loaded", async () => {
		const f = await fixture();
		await expect(
			authorizeMcpServerOAuth({
				...f.options,
				fetch: async () => new Response(null, { status: 404 }),
			}),
		).rejects.toThrow();
		expect(f.counts()).toMatchObject({
			tokenExchanges: 0,
			opened: 0,
			closed: 1,
		});
	});
});
