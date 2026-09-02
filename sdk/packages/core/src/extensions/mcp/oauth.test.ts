import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import { afterEach, describe, expect, it } from "vitest";
import {
	getMcpServerOAuthState,
	listMcpServerOAuthStatuses,
	McpOAuthClientChangedError,
	McpOAuthTransportChangedError,
	updateMcpServerOAuthStateAsync,
	updateMcpSettingsFile,
} from "./config-loader";
import {
	createMcpOAuthProviderContext as createMcpOAuthProviderContextBase,
	createMcpSdkTransport,
	isMcpUnauthorizedError,
} from "./oauth";
import { createMcpOAuthClientPolicyBinding } from "./oauth-client-policy-binding";
import { McpOAuthScopePolicyError } from "./oauth-scope-policy";
import { createMcpOAuthTransportBinding } from "./oauth-transport-binding";

const LINEAR_TRANSPORT = {
	type: "streamableHttp",
	url: "https://mcp.linear.app/mcp",
} as const;
const LINEAR_TRANSPORT_BINDING =
	createMcpOAuthTransportBinding(LINEAR_TRANSPORT);
const DYNAMIC_CLIENT_POLICY_BINDING =
	createMcpOAuthClientPolicyBinding(undefined);

function createMcpOAuthProviderContext(
	options: Omit<
		Parameters<typeof createMcpOAuthProviderContextBase>[0],
		"transportBinding"
	> & { transportBinding?: string },
) {
	return createMcpOAuthProviderContextBase({
		...options,
		transportBinding: options.transportBinding ?? LINEAR_TRANSPORT_BINDING,
	});
}

describe("mcp oauth", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
		tempRoots.length = 0;
	});

	async function createSettingsFile(oauthClient?: {
		clientId: string;
		clientSecret?: string;
		allowedScopes?: string[];
		loopbackHostname?: "127.0.0.1" | "localhost";
	}): Promise<string> {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-oauth-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						linear: {
							transport: LINEAR_TRANSPORT,
							oauthClient,
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);
		return filePath;
	}

	it("tracks the most recent generated OAuth state", async () => {
		const settingsPath = await createSettingsFile();
		const context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
		});

		expect(context.getLastOAuthState()).toBeUndefined();

		const createState = context.provider.state;
		if (!createState) {
			throw new Error("Expected OAuth provider to expose state generator.");
		}

		const firstState = createState();
		expect(context.getLastOAuthState()).toBe(firstState);

		const secondState = createState();
		expect(secondState).not.toBe(firstState);
		expect(context.getLastOAuthState()).toBe(secondState);
	});

	it("does not write redirect state when creating a provider context", async () => {
		const settingsPath = await createSettingsFile();
		const before = await readFile(settingsPath, "utf8");

		createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
		});

		await expect(readFile(settingsPath, "utf8")).resolves.toBe(before);
	});

	it("exposes when a server requires interactive authorization", async () => {
		const settingsPath = await createSettingsFile();
		const context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
		});

		await context.markAuthorizationRequired("OAuth authorization required");
		expect(
			listMcpServerOAuthStatuses({ filePath: settingsPath })[0],
		).toMatchObject({
			oauthConfigured: false,
			authorizationRequired: true,
			lastError: "OAuth authorization required",
		});

		await context.resetInteractiveState();
		expect(
			listMcpServerOAuthStatuses({ filePath: settingsPath })[0],
		).toMatchObject({
			authorizationRequired: true,
			lastError: undefined,
		});

		await context.clearError();
		expect(
			listMcpServerOAuthStatuses({ filePath: settingsPath })[0],
		).toMatchObject({
			authorizationRequired: false,
			lastError: undefined,
		});
	});

	it("does not reuse tokens after the configured OAuth client changes", async () => {
		const settingsPath = await createSettingsFile({
			clientId: "client-a",
			clientSecret: "secret-a",
		});
		const first = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			clientInformation: {
				client_id: "client-a",
				client_secret: "secret-a",
			},
		});
		await first.provider.saveTokens({
			access_token: "old-access-token",
			refresh_token: "old-refresh-token",
			token_type: "bearer",
		});
		expect((await first.provider.tokens())?.access_token).toBe(
			"old-access-token",
		);

		const changedId = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			clientInformation: {
				client_id: "client-b",
				client_secret: "secret-a",
			},
		});
		expect(await changedId.provider.tokens()).toBeUndefined();

		const changedSecret = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			clientInformation: {
				client_id: "client-a",
				client_secret: "secret-b",
			},
		});
		expect(await changedSecret.provider.tokens()).toBeUndefined();
	});

	it("binds persisted tokens and client metadata to the configured scope policy", async () => {
		const settingsPath = await createSettingsFile({
			clientId: "client-a",
			allowedScopes: ["search:read.public", "channels:history"],
		});
		const context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			clientInformation: { client_id: "client-a" },
			allowedScopes: ["search:read.public", "channels:history"],
		});

		expect(context.provider.clientMetadata.scope).toBe(
			"channels:history search:read.public",
		);
		await context.provider.saveTokens({
			access_token: "policy-bound-token",
			token_type: "bearer",
			scope: "channels:history",
		});
		await context.provider.saveCodeVerifier("policy-bound-verifier");
		await context.provider.saveDiscoveryState?.({
			authorizationServerUrl: "https://auth.example.test",
		});
		expect((await context.provider.tokens())?.access_token).toBe(
			"policy-bound-token",
		);

		const written = JSON.parse(await readFile(settingsPath, "utf8"));
		expect(written.mcpServers.linear.oauth.scopePolicy).toEqual([
			"channels:history",
			"search:read.public",
		]);

		const changedPolicy = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1457/mcp/oauth/callback",
			clientInformation: { client_id: "client-a" },
			allowedScopes: ["channels:history"],
		});
		expect(await changedPolicy.provider.tokens()).toBeUndefined();
		expect(changedPolicy.provider.redirectUrl).toBe(
			"http://127.0.0.1:1457/mcp/oauth/callback",
		);
		expect(() => changedPolicy.provider.codeVerifier()).toThrow(
			"Missing OAuth code verifier",
		);
		expect(await changedPolicy.provider.discoveryState?.()).toBeUndefined();
	});

	it("binds persisted tokens and callbacks to the configured loopback hostname", async () => {
		const settingsPath = await createSettingsFile({
			clientId: "client-a",
			loopbackHostname: "localhost",
		});
		const localhostContext = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://localhost:1456/mcp/oauth/callback",
			clientInformation: { client_id: "client-a" },
			loopbackHostname: "localhost",
		});
		await localhostContext.provider.saveTokens({
			access_token: "localhost-bound-token",
			token_type: "bearer",
		});
		expect((await localhostContext.provider.tokens())?.access_token).toBe(
			"localhost-bound-token",
		);
		expect(
			listMcpServerOAuthStatuses({ filePath: settingsPath })[0]
				?.oauthConfigured,
		).toBe(true);

		await updateMcpSettingsFile(settingsPath, (settings) => {
			const servers = settings.mcpServers as Record<string, unknown>;
			const linear = servers.linear as Record<string, unknown>;
			linear.oauthClient = { clientId: "client-a" };
		});
		const ipv4Context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			clientInformation: { client_id: "client-a" },
		});
		expect(await ipv4Context.provider.tokens()).toBeUndefined();
		expect(
			listMcpServerOAuthStatuses({ filePath: settingsPath })[0]
				?.oauthConfigured,
		).toBe(false);
	});

	it("invalidates policy-bound tokens when the configured policy is removed", async () => {
		const settingsPath = await createSettingsFile({
			clientId: "client-a",
			allowedScopes: ["channels:history"],
		});
		const scopedContext = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			clientInformation: { client_id: "client-a" },
			allowedScopes: ["channels:history"],
		});
		await scopedContext.provider.saveTokens({
			access_token: "policy-bound-token",
			token_type: "bearer",
			scope: "channels:history",
		});
		await updateMcpSettingsFile(settingsPath, (settings) => {
			const servers = settings.mcpServers as Record<string, unknown>;
			const linear = servers.linear as Record<string, unknown>;
			linear.oauthClient = { clientId: "client-a" };
		});

		const unscopedContext = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			clientInformation: { client_id: "client-a" },
		});
		expect(await unscopedContext.provider.tokens()).toBeUndefined();
		await unscopedContext.resetInteractiveState();

		const written = JSON.parse(await readFile(settingsPath, "utf8"));
		expect(written.mcpServers.linear.oauth.tokens).toBeUndefined();
		expect(written.mcpServers.linear.oauth.scopePolicy).toBeUndefined();
	});

	it("rejects token responses that grant scopes outside the configured policy", async () => {
		const settingsPath = await createSettingsFile({
			clientId: "client-a",
			allowedScopes: ["channels:history"],
		});
		const context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			clientInformation: { client_id: "client-a" },
			allowedScopes: ["channels:history"],
		});

		await expect(
			context.provider.saveTokens({
				access_token: "over-scoped-token",
				token_type: "bearer",
				scope: "channels:history chat:write",
			}),
		).rejects.toBeInstanceOf(McpOAuthScopePolicyError);
		const written = JSON.parse(await readFile(settingsPath, "utf8"));
		expect(written.mcpServers.linear.oauth).toBeUndefined();
	});

	it("merges updates with the latest OAuth state read under the settings lock", async () => {
		const settingsPath = await createSettingsFile();
		const context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
		});

		await updateMcpServerOAuthStateAsync(
			"linear",
			(current) => ({
				...current,
				authorizationRequired: true,
			}),
			{
				filePath: settingsPath,
				expectedOAuthClient: null,
				expectedTransportBinding: LINEAR_TRANSPORT_BINDING,
			},
		);
		await context.markError("authorization failed");

		expect(
			listMcpServerOAuthStatuses({ filePath: settingsPath })[0],
		).toMatchObject({
			authorizationRequired: true,
			lastError: "authorization failed",
		});
	});

	it("rejects tokens from a callback after the configured client changes", async () => {
		const settingsPath = await createSettingsFile({
			clientId: "client-a",
			clientSecret: "secret-a",
		});
		const context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			clientInformation: {
				client_id: "client-a",
				client_secret: "secret-a",
			},
		});
		await context.resetInteractiveState();

		await updateMcpSettingsFile(settingsPath, (settings) => {
			const servers = settings.mcpServers as Record<string, unknown>;
			const linear = servers.linear as Record<string, unknown>;
			linear.oauthClient = {
				clientId: "client-b",
				clientSecret: "secret-b",
			};
			delete linear.oauth;
		});

		await expect(
			context.provider.saveTokens({
				access_token: "stale-access-token",
				refresh_token: "stale-refresh-token",
				token_type: "bearer",
			}),
		).rejects.toBeInstanceOf(McpOAuthClientChangedError);

		const written = JSON.parse(await readFile(settingsPath, "utf8"));
		expect(written.mcpServers.linear.oauthClient).toEqual({
			clientId: "client-b",
			clientSecret: "secret-b",
		});
		expect(written.mcpServers.linear.oauth).toBeUndefined();
	});

	it("rejects tokens from a callback after the configured scope policy changes", async () => {
		const settingsPath = await createSettingsFile({
			clientId: "client-a",
			allowedScopes: ["channels:history"],
		});
		const context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			clientInformation: { client_id: "client-a" },
			allowedScopes: ["channels:history"],
		});
		await context.resetInteractiveState();

		await updateMcpSettingsFile(settingsPath, (settings) => {
			const servers = settings.mcpServers as Record<string, unknown>;
			const linear = servers.linear as Record<string, unknown>;
			linear.oauthClient = {
				clientId: "client-a",
				allowedScopes: ["search:read.public"],
			};
			delete linear.oauth;
		});

		await expect(
			context.provider.saveTokens({
				access_token: "stale-access-token",
				token_type: "bearer",
				scope: "channels:history",
			}),
		).rejects.toBeInstanceOf(McpOAuthClientChangedError);
		const written = JSON.parse(await readFile(settingsPath, "utf8"));
		expect(written.mcpServers.linear.oauth).toBeUndefined();
	});

	it("rejects tokens from a callback after the loopback hostname changes", async () => {
		const settingsPath = await createSettingsFile({
			clientId: "client-a",
			loopbackHostname: "localhost",
		});
		const context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://localhost:1456/mcp/oauth/callback",
			clientInformation: { client_id: "client-a" },
			loopbackHostname: "localhost",
		});
		await context.resetInteractiveState();

		await updateMcpSettingsFile(settingsPath, (settings) => {
			const servers = settings.mcpServers as Record<string, unknown>;
			const linear = servers.linear as Record<string, unknown>;
			linear.oauthClient = { clientId: "client-a" };
			delete linear.oauth;
		});

		await expect(
			context.provider.saveTokens({
				access_token: "stale-access-token",
				token_type: "bearer",
			}),
		).rejects.toBeInstanceOf(McpOAuthClientChangedError);
	});

	it("fails closed and sanitizes artifacts when a static client is removed", async () => {
		const staticClient = { clientId: "static-client", clientSecret: "secret" };
		const settingsPath = await createSettingsFile(staticClient);
		const staleStaticContext = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			clientInformation: {
				client_id: staticClient.clientId,
				client_secret: staticClient.clientSecret,
			},
		});
		await staleStaticContext.resetInteractiveState();
		await staleStaticContext.provider.saveTokens({
			access_token: "static-token",
			token_type: "bearer",
		});

		await updateMcpSettingsFile(settingsPath, (settings) => {
			const linear = (settings.mcpServers as Record<string, unknown>)
				.linear as Record<string, unknown>;
			delete linear.oauthClient;
		});
		const dynamicContext = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
		});

		expect(await dynamicContext.provider.tokens()).toBeUndefined();
		expect(await dynamicContext.provider.clientInformation?.()).toBeUndefined();
		expect(getMcpServerOAuthState("linear", { filePath: settingsPath })).toBe(
			undefined,
		);
		await expect(
			staleStaticContext.provider.saveTokens({
				access_token: "stale-static-token",
				token_type: "bearer",
			}),
		).rejects.toBeInstanceOf(McpOAuthClientChangedError);

		await dynamicContext.markAuthorizationRequired("dynamic auth required");
		const written = JSON.parse(await readFile(settingsPath, "utf8"));
		expect(written.mcpServers.linear.oauth).toEqual({
			transportBinding: LINEAR_TRANSPORT_BINDING,
			clientPolicyBinding: DYNAMIC_CLIENT_POLICY_BINDING,
			lastError: "dynamic auth required",
			authorizationRequired: true,
		});
	});

	it("fails closed and rejects stale writes when a static client is added", async () => {
		const settingsPath = await createSettingsFile();
		const staleDynamicContext = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
		});
		await staleDynamicContext.provider.saveClientInformation?.({
			client_id: "dynamic-client",
			client_secret: "dynamic-secret",
		});
		await staleDynamicContext.provider.saveTokens({
			access_token: "dynamic-token",
			token_type: "bearer",
		});

		await updateMcpSettingsFile(settingsPath, (settings) => {
			const linear = (settings.mcpServers as Record<string, unknown>)
				.linear as Record<string, unknown>;
			linear.oauthClient = { clientId: "static-client" };
		});
		const staticContext = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			clientInformation: { client_id: "static-client" },
		});

		expect(await staticContext.provider.tokens()).toBeUndefined();
		expect(getMcpServerOAuthState("linear", { filePath: settingsPath })).toBe(
			undefined,
		);
		await expect(
			staleDynamicContext.provider.saveTokens({
				access_token: "stale-dynamic-token",
				token_type: "bearer",
			}),
		).rejects.toBeInstanceOf(McpOAuthClientChangedError);
	});

	it("does not let a stale dynamic registration replace a newer client", async () => {
		const settingsPath = await createSettingsFile();
		const stale = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
		});
		const current = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1457/mcp/oauth/callback",
		});
		if (
			!stale.provider.saveClientInformation ||
			!current.provider.saveClientInformation
		) {
			throw new Error(
				"Expected OAuth providers to persist client information.",
			);
		}

		await current.provider.saveClientInformation({ client_id: "client-b" });
		await expect(
			stale.provider.saveClientInformation({ client_id: "client-a" }),
		).rejects.toBeInstanceOf(McpOAuthClientChangedError);

		const written = JSON.parse(await readFile(settingsPath, "utf8"));
		expect(written.mcpServers.linear.oauth.clientInformation).toEqual({
			client_id: "client-b",
		});
	});

	it("keeps legacy arbitrary dynamic callback identity exact and re-registers when it changes", async () => {
		const settingsPath = await createSettingsFile();
		const original = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://legacy-loopback.test:1456/mcp/oauth/callback",
			persistLoopbackHostname: false,
		});
		await original.provider.saveClientInformation?.({
			client_id: "dynamic-client",
		});
		await original.provider.saveTokens({
			access_token: "callback-bound-token",
			token_type: "bearer",
		});

		const passive = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
		});
		expect(passive.provider.redirectUrl).toBe(
			"http://legacy-loopback.test:1456/mcp/oauth/callback",
		);
		expect((await passive.provider.tokens())?.access_token).toBe(
			"callback-bound-token",
		);

		const changed = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://other-loopback.test:1457/mcp/oauth/callback",
			persistLoopbackHostname: false,
		});
		await changed.resetInteractiveState();
		const written = JSON.parse(await readFile(settingsPath, "utf8"));
		expect(written.mcpServers.linear.oauth).toMatchObject({
			redirectUrl: "http://other-loopback.test:1457/mcp/oauth/callback",
			transportBinding: LINEAR_TRANSPORT_BINDING,
			clientPolicyBinding: DYNAMIC_CLIENT_POLICY_BINDING,
		});
		expect(written.mcpServers.linear.oauth.loopbackHostname).toBeUndefined();
		expect(written.mcpServers.linear.oauth.clientInformation).toBeUndefined();
		expect(written.mcpServers.linear.oauth.tokens).toBeUndefined();
		await changed.provider.saveClientInformation?.({
			client_id: "replacement-dynamic-client",
		});
	});

	function makeSseError(code: number | undefined, message: string): SseError {
		return new SseError(
			code,
			message,
			new Event("error") as ConstructorParameters<typeof SseError>[2],
		);
	}

	it("recognizes 401s in every transport error shape", () => {
		expect(
			isMcpUnauthorizedError(
				new UnauthorizedError("MCP server requires authorization"),
			),
		).toBe(true);
		expect(
			isMcpUnauthorizedError(makeSseError(401, "Non-200 status code (401)")),
		).toBe(true);
		expect(
			isMcpUnauthorizedError(makeSseError(404, "Non-200 status code (404)")),
		).toBe(false);
		expect(
			isMcpUnauthorizedError(makeSseError(undefined, "fetch failed")),
		).toBe(false);
		expect(isMcpUnauthorizedError(new Error("Unauthorized"))).toBe(false);
	});

	it("surfaces a passive SSE stream 401 as a recognizable error", async () => {
		const transport = createMcpSdkTransport({
			registration: {
				name: "linear",
				transport: { type: "sse", url: "https://mcp.example.test/sse" },
			},
			fetch: async () => new Response(null, { status: 401 }),
		});
		try {
			const error = await transport.start().then(
				() => undefined,
				(cause: unknown) => cause,
			);
			expect(error).toBeInstanceOf(SseError);
			expect(isMcpUnauthorizedError(error)).toBe(true);
		} finally {
			await transport.close();
		}
	});

	it("keeps typing passive streamable HTTP 401s at the fetch boundary", async () => {
		const transport = createMcpSdkTransport({
			registration: {
				name: "linear",
				transport: { type: "streamableHttp", url: "https://mcp.example.test" },
			},
			fetch: async () => new Response(null, { status: 401 }),
		});
		try {
			const error = await transport
				.send({ jsonrpc: "2.0", id: 1, method: "initialize" })
				.then(
					() => undefined,
					(cause: unknown) => cause,
				);
			expect(error).toBeInstanceOf(UnauthorizedError);
			expect(isMcpUnauthorizedError(error)).toBe(true);
		} finally {
			await transport.close();
		}
	});

	it("fails closed for legacy OAuth state without a transport binding", async () => {
		const settingsPath = await createSettingsFile();
		const settings = JSON.parse(await readFile(settingsPath, "utf8"));
		settings.mcpServers.linear.oauth = {
			clientInformation: {
				client_id: "dynamically-registered-client",
				client_secret: "registered-secret",
			},
			tokens: {
				access_token: "legacy-access-token",
				refresh_token: "legacy-refresh-token",
				token_type: "bearer",
			},
			redirectUrl: "http://127.0.0.1:1456/legacy",
			codeVerifier: "legacy-verifier",
			discoveryState: {
				authorizationServerUrl: "https://auth.legacy.example.test",
			},
			lastAuthenticatedAt: 1_700_000_000_000,
		};
		await writeFile(settingsPath, JSON.stringify(settings), "utf8");

		const context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
		});

		expect(getMcpServerOAuthState("linear", { filePath: settingsPath })).toBe(
			undefined,
		);
		expect(await context.provider.tokens()).toBeUndefined();
		expect(await context.provider.clientInformation?.()).toBeUndefined();
		expect(context.provider.redirectUrl).toBe(
			"http://127.0.0.1:1456/mcp/oauth/callback",
		);
		expect(await context.provider.discoveryState?.()).toBeUndefined();
		expect(() => context.provider.codeVerifier?.()).toThrow(
			"Missing OAuth code verifier",
		);
		expect(
			listMcpServerOAuthStatuses({ filePath: settingsPath })[0],
		).toMatchObject({
			oauthConfigured: false,
			lastAuthenticatedAt: undefined,
		});

		await context.markAuthorizationRequired("authorization required");
		const written = JSON.parse(await readFile(settingsPath, "utf8"));
		expect(written.mcpServers.linear.oauth).toEqual({
			transportBinding: LINEAR_TRANSPORT_BINDING,
			clientPolicyBinding: DYNAMIC_CLIENT_POLICY_BINDING,
			lastError: "authorization required",
			authorizationRequired: true,
		});
	});

	it("preserves bound tokens when remote headers are only reordered", async () => {
		const settingsPath = await createSettingsFile();
		await updateMcpSettingsFile(settingsPath, (settings) => {
			const linear = (settings.mcpServers as Record<string, unknown>)
				.linear as { transport: { headers?: Record<string, string> } };
			linear.transport.headers = {
				"X-Tenant": "engineering",
				"X-Region": "us-west",
			};
		});
		const binding = createMcpOAuthTransportBinding({
			...LINEAR_TRANSPORT,
			headers: {
				"x-region": "us-west",
				"x-tenant": "engineering",
			},
		});
		const context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			transportBinding: binding,
		});
		await context.provider.saveClientInformation?.({
			client_id: "dynamic-client",
		});
		await context.provider.saveTokens({
			access_token: "header-bound-token",
			token_type: "bearer",
		});

		await updateMcpSettingsFile(settingsPath, (settings) => {
			const linear = (settings.mcpServers as Record<string, unknown>)
				.linear as { transport: { headers?: Record<string, string> } };
			linear.transport.headers = {
				"x-region": "us-west",
				"x-tenant": "engineering",
			};
		});

		expect((await context.provider.tokens())?.access_token).toBe(
			"header-bound-token",
		);
	});

	it("rejects every stale write after the remote transport changes", async () => {
		const settingsPath = await createSettingsFile({ clientId: "client-a" });
		const context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			clientInformation: { client_id: "client-a" },
		});
		await context.resetInteractiveState();
		await updateMcpSettingsFile(settingsPath, (settings) => {
			const linear = (settings.mcpServers as Record<string, unknown>)
				.linear as { transport: { url: string } };
			linear.transport.url = "https://replacement.example.test/mcp";
		});

		await expect(
			context.provider.saveTokens({
				access_token: "stale-token",
				token_type: "bearer",
			}),
		).rejects.toBeInstanceOf(McpOAuthTransportChangedError);
		await expect(context.markError("stale error")).rejects.toBeInstanceOf(
			McpOAuthTransportChangedError,
		);

		const written = JSON.parse(await readFile(settingsPath, "utf8"));
		expect(written.mcpServers.linear.oauth.tokens).toBeUndefined();
		expect(written.mcpServers.linear.oauth.lastError).toBeUndefined();
	});

	it("sanitizes mismatched artifacts before binding a current diagnostic", async () => {
		const settingsPath = await createSettingsFile();
		const settings = JSON.parse(await readFile(settingsPath, "utf8"));
		settings.mcpServers.linear.transport.url =
			"https://replacement.example.test/mcp";
		settings.mcpServers.linear.oauth = {
			transportBinding: LINEAR_TRANSPORT_BINDING,
			clientInformation: {
				client_id: "old-client",
				client_secret: "old-secret",
			},
			tokens: {
				access_token: "old-token",
				refresh_token: "old-refresh",
			},
			redirectUrl: "http://127.0.0.1:1456/old",
			codeVerifier: "old-verifier",
			discoveryState: { tokenEndpoint: "https://old.example.test/token" },
			lastAuthenticatedAt: 1_700_000_000_000,
		};
		await writeFile(settingsPath, JSON.stringify(settings), "utf8");
		const replacementBinding = createMcpOAuthTransportBinding({
			type: "streamableHttp",
			url: "https://replacement.example.test/mcp",
		});
		const context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			transportBinding: replacementBinding,
		});

		await context.markAuthorizationRequired("new endpoint requires auth");
		const written = JSON.parse(await readFile(settingsPath, "utf8"));
		expect(written.mcpServers.linear.oauth).toEqual({
			transportBinding: replacementBinding,
			clientPolicyBinding: DYNAMIC_CLIENT_POLICY_BINDING,
			lastError: "new endpoint requires auth",
			authorizationRequired: true,
		});
	});
});
