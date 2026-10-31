import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, it } from "vitest";
import { updateMcpServerOAuthStateAsync } from "./config-loader";
import {
	authorizeMcpServerOAuth,
	createOriginBoundMcpHeadersFetch,
} from "./oauth";

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
			customChallenge?: boolean;
			accessOnly?: boolean;
			resourceUrl?: string;
			postChallengeOnly?: boolean;
			listChallengeOnly?: boolean;
			rejectStaleAccess?: boolean;
		} = {},
	) {
		const resource = config.resourceUrl ?? "https://mcp.example.test/mcp";
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
		let acceptedRequests = 0;
		let anonymousListChallenges = 0;
		const fetchFixture: FetchLike = async (input, init) => {
			const url = new URL(
				input instanceof Request ? input.url : input.toString(),
			);
			const json = (value: unknown, status = 200) =>
				new Response(JSON.stringify(value), {
					status,
					headers: { "content-type": "application/json" },
				});
			const requestBody = init?.body
				? await new Response(
						init.body as ConstructorParameters<typeof Response>[0],
					).text()
				: "";
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
			if (
				config.customChallenge &&
				url.pathname.includes("oauth-protected-resource")
			)
				return new Response(null, { status: 404 });
			if (
				url.pathname === "/tenant/protected-resource" ||
				url.pathname.includes("oauth-protected-resource")
			)
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
					...JSON.parse(requestBody),
				});
			if (url.pathname === "/token") {
				const body = new URLSearchParams(requestBody);
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
					...(config.accessOnly ? {} : { refresh_token: "fixture-refresh" }),
					token_type: "Bearer",
					expires_in: 3600,
				});
			}
			if (url.href === resource && init?.method === "GET") {
				if (config.postChallengeOnly || config.listChallengeOnly)
					return new Response(null, { status: 405 });
				if (new Headers(init.headers).has("authorization"))
					return new Response(null, { status: 405 });
				return new Response(null, {
					status: 401,
					headers: {
						"www-authenticate": config.customChallenge
							? `Bearer resource_metadata="https://mcp.example.test/tenant/protected-resource", scope="tenant:write"`
							: `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource", resource)}"`,
					},
				});
			}
			if (url.href === resource && init?.method === "POST") {
				const body = JSON.parse(requestBody);
				const protectedList =
					config.listChallengeOnly &&
					body.method === "tools/list" &&
					!headers.has("authorization");
				if (protectedList) anonymousListChallenges++;
				if (
					protectedList ||
					(config.postChallengeOnly && !headers.has("authorization")) ||
					(config.rejectStaleAccess &&
						headers.get("authorization") !== "Bearer fixture-access")
				)
					return new Response(null, {
						status: 401,
						headers: {
							"www-authenticate": `Bearer resource_metadata="https://mcp.example.test/tenant/protected-resource", scope="tenant:write"`,
						},
					});
				if (body.id === undefined) return new Response(null, { status: 202 });
				if (headers.get("authorization") === "Bearer fixture-access")
					acceptedRequests++;
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
			headerCounts: () => ({
				escaped,
				gatewayRequests,
				acceptedRequests,
				anonymousListChallenges,
			}),
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
					if (config.customChallenge)
						expect(url.searchParams.get("scope")).toBe("tenant:write");
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
				refreshes: 0,
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
		expect(f.counts().refreshes).toBe(0);
	});

	it.each([
		"register",
		"token",
	] as const)("rejects cross-origin %s redirects without forwarding requests", async (redirect) => {
		const f = await fixture({
			headers: { "X-Tenant": "fixture-tenant" },
			redirect,
		});
		f.releaseMetadata();
		await expect(authorizeMcpServerOAuth(f.options)).rejects.toThrow();
		expect(f.headerCounts().escaped).toBe(0);
		expect(f.counts().closed).toBe(1);
	});

	it("uses challenge-only resource metadata and scope throughout code exchange", async () => {
		const f = await fixture({ customChallenge: true, postChallengeOnly: true });
		f.releaseMetadata();
		await expect(authorizeMcpServerOAuth(f.options)).resolves.toMatchObject({
			authorized: true,
		});
		expect(f.counts()).toMatchObject({ opened: 1, tokenExchanges: 1 });
	});

	it("uses tools/list challenge metadata after anonymous initialization without a saved token", async () => {
		const f = await fixture({ customChallenge: true, listChallengeOnly: true });
		f.releaseMetadata();
		await expect(authorizeMcpServerOAuth(f.options)).resolves.toMatchObject({
			authorized: true,
		});
		expect(f.headerCounts().anonymousListChallenges).toBe(1);
		expect(f.counts()).toEqual({
			opened: 1,
			tokenExchanges: 1,
			refreshes: 0,
			closed: 1,
		});
	});

	it("checks accepted owned access tokens without requiring a refresh token or browser", async () => {
		const f = await fixture({ accessOnly: true });
		f.releaseMetadata();
		await updateMcpServerOAuthStateAsync(
			"remote",
			() => ({
				clientInformation: { client_id: "fixture-client" },
				tokens: { access_token: "fixture-access", token_type: "Bearer" },
			}),
			{ filePath: f.filePath },
		);
		await expect(authorizeMcpServerOAuth(f.options)).resolves.toMatchObject({
			authorized: true,
		});
		expect(f.counts()).toEqual({
			opened: 0,
			tokenExchanges: 0,
			refreshes: 0,
			closed: 1,
		});
	});

	it("refreshes a rejected owned access token without opening browser consent", async () => {
		const f = await fixture({
			headers: {
				"X-Tenant": "fixture-tenant",
				"Content-Type": "application/vnd.gateway+json",
			},
			customChallenge: true,
			postChallengeOnly: true,
			rejectStaleAccess: true,
		});
		f.releaseMetadata();
		await updateMcpServerOAuthStateAsync(
			"remote",
			() => ({
				clientInformation: { client_id: "fixture-client" },
				tokens: {
					access_token: "fixture-stale",
					refresh_token: "fixture-refresh",
					token_type: "Bearer",
				},
			}),
			{ filePath: f.filePath },
		);
		await expect(authorizeMcpServerOAuth(f.options)).resolves.toMatchObject({
			authorized: true,
		});
		expect(f.counts()).toEqual({
			opened: 0,
			tokenExchanges: 0,
			refreshes: 1,
			closed: 1,
		});
		expect(f.headerCounts().acceptedRequests).toBe(2);
	});

	it("strips configured headers when the challenge probe follows a same-origin hop cross-origin", async () => {
		const destinationHeaders: Headers[] = [];
		const sameOriginHeaders: Headers[] = [];
		const destination = createHttpServer((request, response) => {
			destinationHeaders.push(
				new Headers(request.headers as Record<string, string>),
			);
			response.statusCode = 401;
			response.setHeader(
				"www-authenticate",
				`Bearer resource_metadata="https://mcp.example.test/tenant/protected-resource"`,
			);
			response.end();
		});
		const gateway = createHttpServer((request, response) => {
			sameOriginHeaders.push(
				new Headers(request.headers as Record<string, string>),
			);
			response.statusCode = 302;
			response.setHeader(
				"location",
				request.url === "/hop" ? `${destinationOrigin}/metadata` : "/hop",
			);
			response.end();
		});
		async function listen(server: ReturnType<typeof createHttpServer>) {
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("No fixture port");
			return `http://127.0.0.1:${address.port}`;
		}
		const destinationOrigin = await listen(destination);
		const gatewayOrigin = await listen(gateway);
		const endpoint = `${gatewayOrigin}/mcp`;
		try {
			const f = await fixture({
				resourceUrl: endpoint,
				headers: { "X-Tenant": "fixture-tenant", Cookie: "fixture-cookie" },
			});
			f.releaseMetadata();
			await expect(
				authorizeMcpServerOAuth({
					...f.options,
					fetch: (input, init) => {
						const url = new URL(
							input instanceof Request ? input.url : input.toString(),
						);
						return (url.origin === gatewayOrigin &&
							init?.method === "GET" &&
							!new Headers(init.headers).has("authorization")) ||
							url.origin === destinationOrigin
							? fetch(input, init as RequestInit)
							: f.fetchFixture(input, init);
					},
				}),
			).resolves.toMatchObject({ authorized: true });
			expect(sameOriginHeaders.length).toBeGreaterThanOrEqual(2);
			for (const headers of sameOriginHeaders)
				expect(headers.get("x-tenant")).toBe("fixture-tenant");
			expect(destinationHeaders.length).toBeGreaterThanOrEqual(1);
			for (const headers of destinationHeaders) {
				expect(headers.has("x-tenant")).toBe(false);
				expect(headers.has("cookie")).toBe(false);
			}
		} finally {
			await Promise.all(
				[gateway, destination].map(
					(server) =>
						new Promise<void>((resolve, reject) =>
							server.close((error) => (error ? reject(error) : resolve())),
						),
				),
			);
		}
	});

	it.each([
		"manual",
		"error",
	] as const)("preserves the caller's %s redirect policy", async (redirect) => {
		let requests = 0;
		const guardedFetch = createOriginBoundMcpHeadersFetch({
			endpointUrl: "https://gateway.example.test/mcp",
			configuredHeaders: { "X-Tenant": "fixture-tenant" },
			baseFetch: async () => {
				requests++;
				return requests === 1
					? new Response(null, {
							status: 307,
							headers: { location: "https://other.example.test/receive" },
						})
					: new Response(null);
			},
		});
		const result = guardedFetch("https://gateway.example.test/token", {
			method: "POST",
			body: "fixture-body",
			redirect,
		});
		if (redirect === "manual") expect((await result).status).toBe(307);
		else await expect(result).rejects.toThrow("redirect");
		expect(requests).toBe(1);
	});

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
