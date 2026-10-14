import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import { afterEach, describe, expect, it } from "vitest";
import {
	listMcpServerOAuthStatuses,
	McpOAuthClientChangedError,
	updateMcpServerOAuthStateAsync,
	updateMcpSettingsFile,
} from "./config-loader";
import {
	createMcpOAuthProviderContext,
	createMcpSdkTransport,
	isMcpUnauthorizedError,
} from "./oauth";

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
							transport: {
								type: "streamableHttp",
								url: "https://mcp.linear.app/mcp",
							},
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
			{ filePath: settingsPath },
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

	it("reuses tokens persisted before client binding was introduced", async () => {
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
		};
		await writeFile(settingsPath, JSON.stringify(settings), "utf8");

		const context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
		});

		expect((await context.provider.tokens())?.access_token).toBe(
			"legacy-access-token",
		);

		if (!context.provider.saveClientInformation) {
			throw new Error(
				"Expected OAuth provider to expose saveClientInformation.",
			);
		}
		await context.provider.saveClientInformation({
			client_id: "replacement-client",
			client_secret: "replacement-secret",
		});
		expect(await context.provider.tokens()).toBeUndefined();
	});
});
