import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpOAuthProviderContext } from "./oauth";

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

	async function createSettingsFile(): Promise<string> {
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

	it("does not reuse tokens after the configured OAuth client changes", async () => {
		const settingsPath = await createSettingsFile();
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
		expect((await first.provider.tokens())?.access_token).toBe("old-access-token");

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

		expect((await context.provider.tokens())?.access_token).toBe("legacy-access-token");

		if (!context.provider.saveClientInformation) {
			throw new Error("Expected OAuth provider to expose saveClientInformation.");
		}
		await context.provider.saveClientInformation({
			client_id: "replacement-client",
			client_secret: "replacement-secret",
		});
		expect(await context.provider.tokens()).toBeUndefined();
	});
});
