import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createMcpOAuthClientPolicyBinding,
	createMcpOAuthTransportBinding,
} from "@cline/core";
import { describe, expect, it } from "vitest";
import { handleCommand } from "./commands";
import {
	buildMcpServersResponse,
	resolveMcpOAuthClientUpdate,
	shouldProbeMcpServerAfterUpsert,
} from "./mcp";
import type { JsonRecord, SidecarContext } from "./types";

function createContext(workspaceRoot: string): SidecarContext {
	return {
		liveSessions: new Map(),
		restoringWorkspacePaths: new Set(),
		streamIndices: new Map(),
		wsClients: new Set(),
		pendingApprovals: new Map(),
		pendingQuestions: new Map(),
		sessionManager: null,
		hubClient: null,
		workspaceRoot,
		unsubscribeSessionEvents: null,
		hubBuildMismatch: null,
	};
}

describe("desktop MCP settings", () => {
	it("keeps valid and malformed entries visible independently", () => {
		const response = buildMcpServersResponse("/tmp/cline_mcp_settings.json", {
			mcpServers: {
				linear: {
					transport: {
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
					disabled: true,
					oauthClient: {
						clientId: "desktop-client",
						clientSecret: "must-not-leave-the-sidecar",
						allowedScopes: ["search:read.public", "channels:history"],
						loopbackHostname: "localhost",
					},
					oauth: {
						transportBinding: createMcpOAuthTransportBinding({
							type: "streamableHttp",
							url: "https://mcp.linear.app/mcp",
						}),
						clientPolicyBinding: createMcpOAuthClientPolicyBinding({
							clientId: "desktop-client",
							clientSecret: "must-not-leave-the-sidecar",
							allowedScopes: ["search:read.public", "channels:history"],
							loopbackHostname: "localhost",
						}),
						authorizationRequired: true,
						lastError: "OAuth authorization required",
					},
				},
				broken: {},
			},
		});
		const servers = response.servers as JsonRecord[];

		expect(servers).toHaveLength(2);
		expect(servers[0]).toMatchObject({
			name: "linear",
			transportType: "streamableHttp",
			url: "https://mcp.linear.app/mcp",
			disabled: true,
			oauthClient: {
				clientId: "desktop-client",
				hasClientSecret: true,
				allowedScopes: ["channels:history", "search:read.public"],
				loopbackHostname: "localhost",
			},
			oauthStatus: {
				authorizationRequired: true,
				lastError: "OAuth authorization required",
			},
		});
		expect(servers[1]).toMatchObject({
			name: "broken",
			transportType: "stdio",
		});
		expect(String(servers[1]?.configurationError)).toContain(
			'Invalid MCP server "broken"',
		);
		expect(JSON.stringify(response)).not.toContain(
			"must-not-leave-the-sidecar",
		);
	});

	it("does not probe an unchanged enabled remote server after editing", () => {
		expect(
			shouldProbeMcpServerAfterUpsert({
				isRemote: true,
				requestedDisabled: false,
				existingWasEnabled: true,
				transportIdentityUnchanged: true,
			}),
		).toBe(false);
		expect(
			shouldProbeMcpServerAfterUpsert({
				isRemote: true,
				requestedDisabled: false,
				existingWasEnabled: true,
				transportIdentityUnchanged: false,
			}),
		).toBe(true);
		expect(
			shouldProbeMcpServerAfterUpsert({
				isRemote: true,
				requestedDisabled: false,
				existingWasEnabled: true,
				transportIdentityUnchanged: true,
				oauthClientUnchanged: false,
			}),
		).toBe(true);
	});

	it("validates requests to preserve a redacted OAuth client secret", () => {
		expect(() =>
			resolveMcpOAuthClientUpdate({
				requestedOAuthClient: {
					clientId: "replacement-client",
					preserveClientSecret: true,
				},
				existingOAuthClient: {
					clientId: "desktop-client",
					clientSecret: "saved-secret",
				},
				transportIdentityUnchanged: true,
			}),
		).toThrow("cannot be preserved for this client ID");
		expect(() =>
			resolveMcpOAuthClientUpdate({
				requestedOAuthClient: {
					clientId: "desktop-client",
					preserveClientSecret: true,
				},
				existingOAuthClient: {
					clientId: "desktop-client",
					clientSecret: "saved-secret",
				},
				transportIdentityUnchanged: false,
			}),
		).toThrow("server transport, URL, or headers");
	});

	it("fails closed on malformed or unknown OAuth scope policy input", () => {
		const base = {
			clientId: "desktop-client",
			allowedScopes: ["channels:history"],
		};
		for (const requestedOAuthClient of [
			{ ...base, allowedScopes: [] },
			{ ...base, allowedScopes: ["channels:history", "channels:history"] },
			{ ...base, allowedScopes: ["channels:history chat:write"] },
			{ ...base, allowedScopes: "channels:history" },
			{ ...base, unexpected: true },
			{ ...base, loopbackHostname: "example.com" },
		]) {
			expect(() =>
				resolveMcpOAuthClientUpdate({
					requestedOAuthClient,
					existingOAuthClient: undefined,
					transportIdentityUnchanged: false,
				}),
			).toThrow();
		}
	});

	it("preserves, changes, and clears the closed loopback hostname choice", () => {
		const existingOAuthClient = {
			clientId: "desktop-client",
			clientSecret: "saved-secret",
			loopbackHostname: "localhost",
		};
		expect(
			resolveMcpOAuthClientUpdate({
				requestedOAuthClient: {
					clientId: "desktop-client",
					preserveClientSecret: true,
				},
				existingOAuthClient,
				transportIdentityUnchanged: true,
			}).oauthClient,
		).toEqual(existingOAuthClient);
		expect(
			resolveMcpOAuthClientUpdate({
				requestedOAuthClient: {
					clientId: "desktop-client",
					preserveClientSecret: true,
					loopbackHostname: null,
				},
				existingOAuthClient,
				transportIdentityUnchanged: true,
			}),
		).toEqual({
			oauthClient: {
				clientId: "desktop-client",
				clientSecret: "saved-secret",
			},
			oauthClientUnchanged: false,
		});
	});

	it("preserves a saved OAuth client secret and its current OAuth state", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "desktop-mcp-oauth-"));
		const settingsPath = join(tempRoot, "cline_mcp_settings.json");
		const previousSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		try {
			await writeFile(
				settingsPath,
				JSON.stringify({
					mcpServers: {
						slack: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.slack.com/mcp",
							},
							disabled: true,
							oauthClient: {
								clientId: "desktop-client",
								clientSecret: "saved-secret",
								allowedScopes: ["search:read.public", "channels:history"],
							},
							oauth: {
								tokens: { access_token: "saved-token" },
							},
						},
					},
				}),
				"utf8",
			);

			const response = (await handleCommand(
				createContext(tempRoot),
				"upsert_mcp_server",
				{
					input: {
						name: "slack",
						previousName: "slack",
						transportType: "streamableHttp",
						url: "https://mcp.slack.com/mcp",
						disabled: true,
						oauthClient: {
							clientId: "desktop-client",
							preserveClientSecret: true,
						},
					},
				},
			)) as JsonRecord;
			expect(response.servers).toEqual([
				expect.objectContaining({
					name: "slack",
					oauthClient: {
						clientId: "desktop-client",
						hasClientSecret: true,
						allowedScopes: ["channels:history", "search:read.public"],
					},
				}),
			]);
			expect(JSON.stringify(response)).not.toContain("saved-secret");
			expect(JSON.stringify(response)).not.toContain("saved-token");

			const written = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(written.mcpServers.slack.oauthClient).toEqual({
				clientId: "desktop-client",
				clientSecret: "saved-secret",
				allowedScopes: ["search:read.public", "channels:history"],
			});
			expect(written.mcpServers.slack.oauth).toEqual({
				tokens: { access_token: "saved-token" },
			});
		} finally {
			if (previousSettingsPath === undefined) {
				delete process.env.CLINE_MCP_SETTINGS_PATH;
			} else {
				process.env.CLINE_MCP_SETTINGS_PATH = previousSettingsPath;
			}
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("canonicalizes scope edits and invalidates OAuth state only for policy changes", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "desktop-mcp-scopes-"));
		const settingsPath = join(tempRoot, "cline_mcp_settings.json");
		const previousSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		try {
			const writeScopedServer = async () =>
				writeFile(
					settingsPath,
					JSON.stringify({
						mcpServers: {
							slack: {
								transport: {
									type: "streamableHttp",
									url: "https://mcp.slack.com/mcp",
								},
								disabled: true,
								oauthClient: {
									clientId: "desktop-client",
									clientSecret: "saved-secret",
									allowedScopes: ["search:read.public", "channels:history"],
								},
								oauth: {
									tokens: { access_token: "saved-token" },
								},
							},
						},
					}),
					"utf8",
				);

			await writeScopedServer();
			await handleCommand(createContext(tempRoot), "upsert_mcp_server", {
				input: {
					name: "slack",
					previousName: "slack",
					transportType: "streamableHttp",
					url: "https://mcp.slack.com/mcp",
					disabled: true,
					oauthClient: {
						clientId: "desktop-client",
						preserveClientSecret: true,
						allowedScopes: ["channels:history", "search:read.public"],
					},
				},
			});
			let written = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(written.mcpServers.slack.oauthClient.allowedScopes).toEqual([
				"channels:history",
				"search:read.public",
			]);
			expect(written.mcpServers.slack.oauth).toEqual({
				tokens: { access_token: "saved-token" },
			});

			await writeScopedServer();
			await handleCommand(createContext(tempRoot), "upsert_mcp_server", {
				input: {
					name: "slack",
					previousName: "slack",
					transportType: "streamableHttp",
					url: "https://mcp.slack.com/mcp",
					disabled: true,
					oauthClient: {
						clientId: "desktop-client",
						preserveClientSecret: true,
						allowedScopes: ["channels:history"],
					},
				},
			});
			written = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(written.mcpServers.slack.oauthClient).toEqual({
				clientId: "desktop-client",
				clientSecret: "saved-secret",
				allowedScopes: ["channels:history"],
			});
			expect(written.mcpServers.slack.oauth).toBeUndefined();
			expect(
				shouldProbeMcpServerAfterUpsert({
					isRemote: true,
					requestedDisabled: false,
					existingWasEnabled: true,
					transportIdentityUnchanged: true,
					oauthClientUnchanged: false,
				}),
			).toBe(true);

			await writeScopedServer();
			await handleCommand(createContext(tempRoot), "upsert_mcp_server", {
				input: {
					name: "slack",
					previousName: "slack",
					transportType: "streamableHttp",
					url: "https://mcp.slack.com/mcp",
					disabled: true,
					oauthClient: {
						clientId: "desktop-client",
						preserveClientSecret: true,
						allowedScopes: null,
					},
				},
			});
			written = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(written.mcpServers.slack.oauthClient).toEqual({
				clientId: "desktop-client",
				clientSecret: "saved-secret",
			});
			expect(written.mcpServers.slack.oauth).toBeUndefined();
		} finally {
			if (previousSettingsPath === undefined) {
				delete process.env.CLINE_MCP_SETTINGS_PATH;
			} else {
				process.env.CLINE_MCP_SETTINGS_PATH = previousSettingsPath;
			}
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("binds OAuth state and saved secrets to canonical remote headers", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "desktop-mcp-headers-"));
		const settingsPath = join(tempRoot, "cline_mcp_settings.json");
		const previousSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		const originalHeaders = {
			Authorization: "Bearer fixed-test-header",
			"X-Tenant": "one",
		};
		const reorderedHeaders = {
			"X-Tenant": "one",
			Authorization: "Bearer fixed-test-header",
		};
		const changedHeaders = {
			Authorization: "Bearer fixed-test-header",
			"X-Tenant": "two",
		};
		const writeServer = async () =>
			writeFile(
				settingsPath,
				JSON.stringify({
					mcpServers: {
						proxied: {
							transport: {
								type: "streamableHttp",
								url: "http://127.0.0.1:1/mcp",
								headers: originalHeaders,
							},
							disabled: false,
							oauthClient: {
								clientId: "desktop-client",
								clientSecret: "saved-secret",
							},
							oauth: {
								clientInformation: {
									client_id: "desktop-client",
									client_secret: "saved-secret",
								},
								tokens: { access_token: "saved-token" },
							},
						},
					},
				}),
				"utf8",
			);
		try {
			await writeServer();
			await handleCommand(createContext(tempRoot), "upsert_mcp_server", {
				input: {
					name: "proxied",
					previousName: "proxied",
					transportType: "streamableHttp",
					url: "http://127.0.0.1:1/mcp",
					headers: reorderedHeaders,
					disabled: false,
					oauthClient: {
						clientId: "desktop-client",
						preserveClientSecret: true,
						allowedScopes: null,
					},
				},
			});
			let written = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(written.mcpServers.proxied.disabled).toBe(false);
			expect(written.mcpServers.proxied.oauthClient.clientSecret).toBe(
				"saved-secret",
			);
			expect(written.mcpServers.proxied.oauth.tokens.access_token).toBe(
				"saved-token",
			);

			await writeServer();
			await expect(
				handleCommand(createContext(tempRoot), "upsert_mcp_server", {
					input: {
						name: "proxied",
						previousName: "proxied",
						transportType: "streamableHttp",
						url: "http://127.0.0.1:1/mcp",
						headers: changedHeaders,
						disabled: false,
						oauthClient: {
							clientId: "desktop-client",
							preserveClientSecret: true,
							allowedScopes: null,
						},
					},
				}),
			).rejects.toThrow("server transport, URL, or headers");
			written = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(written.mcpServers.proxied.transport.headers).toEqual(
				originalHeaders,
			);
			expect(written.mcpServers.proxied.oauth.tokens.access_token).toBe(
				"saved-token",
			);

			await writeServer();
			const response = (await handleCommand(
				createContext(tempRoot),
				"upsert_mcp_server",
				{
					input: {
						name: "proxied",
						previousName: "proxied",
						transportType: "streamableHttp",
						url: "http://127.0.0.1:1/mcp",
						headers: changedHeaders,
						disabled: false,
						oauthClient: {
							clientId: "desktop-client",
							allowedScopes: null,
						},
					},
				},
			)) as JsonRecord;
			const server = (response.servers as JsonRecord[]).find(
				(candidate) => candidate.name === "proxied",
			);
			expect(server).toMatchObject({
				disabled: true,
				oauthClient: {
					clientId: "desktop-client",
					hasClientSecret: false,
				},
			});
			expect(
				typeof (server?.oauthStatus as JsonRecord | undefined)?.lastError,
			).toBe("string");
			written = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(written.mcpServers.proxied.disabled).toBe(true);
			expect(written.mcpServers.proxied.transport.headers).toEqual(
				changedHeaders,
			);
			expect(written.mcpServers.proxied.oauthClient).toEqual({
				clientId: "desktop-client",
			});
			expect(written.mcpServers.proxied.oauth?.tokens).toBeUndefined();
		} finally {
			if (previousSettingsPath === undefined) {
				delete process.env.CLINE_MCP_SETTINGS_PATH;
			} else {
				process.env.CLINE_MCP_SETTINGS_PATH = previousSettingsPath;
			}
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("invalidates OAuth state when the OAuth client changes or clears", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "desktop-mcp-oauth-"));
		const settingsPath = join(tempRoot, "cline_mcp_settings.json");
		const previousSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		try {
			const cases = [
				{
					name: "replace client and secret",
					oauthClient: {
						clientId: "replacement-client",
						clientSecret: "replacement-secret",
					},
					expected: {
						clientId: "replacement-client",
						clientSecret: "replacement-secret",
					},
				},
				{
					name: "clear only the secret",
					oauthClient: { clientId: "desktop-client" },
					expected: { clientId: "desktop-client" },
				},
				{
					name: "change the loopback hostname",
					oauthClient: {
						clientId: "desktop-client",
						preserveClientSecret: true,
						loopbackHostname: "localhost",
					},
					expected: {
						clientId: "desktop-client",
						clientSecret: "saved-secret",
						loopbackHostname: "localhost",
					},
				},
				{
					name: "clear the client",
					oauthClient: null,
					expected: undefined,
				},
			] as const;

			for (const testCase of cases) {
				await writeFile(
					settingsPath,
					JSON.stringify({
						mcpServers: {
							slack: {
								transport: {
									type: "streamableHttp",
									url: "https://mcp.slack.com/mcp",
								},
								disabled: true,
								oauthClient: {
									clientId: "desktop-client",
									clientSecret: "saved-secret",
								},
								oauth: {
									tokens: { access_token: "saved-token" },
								},
							},
						},
					}),
					"utf8",
				);

				await handleCommand(createContext(tempRoot), "upsert_mcp_server", {
					input: {
						name: "slack",
						previousName: "slack",
						transportType: "streamableHttp",
						url: "https://mcp.slack.com/mcp",
						disabled: true,
						oauthClient: testCase.oauthClient,
					},
				});

				const written = JSON.parse(await readFile(settingsPath, "utf8"));
				expect(written.mcpServers.slack.oauthClient, testCase.name).toEqual(
					testCase.expected,
				);
				expect(written.mcpServers.slack.oauth, testCase.name).toBeUndefined();
			}
		} finally {
			if (previousSettingsPath === undefined) {
				delete process.env.CLINE_MCP_SETTINGS_PATH;
			} else {
				process.env.CLINE_MCP_SETTINGS_PATH = previousSettingsPath;
			}
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("retains an explicit localhost callback while changing endpoints", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "desktop-mcp-oauth-"));
		const settingsPath = join(tempRoot, "cline_mcp_settings.json");
		const previousSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		try {
			await writeFile(
				settingsPath,
				JSON.stringify({
					mcpServers: {
						slack: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.slack.com/mcp",
							},
							disabled: true,
							oauthClient: {
								clientId: "desktop-client",
								clientSecret: "saved-secret",
								loopbackHostname: "localhost",
							},
							oauth: {
								tokens: { access_token: "saved-token" },
								loopbackHostname: "localhost",
							},
						},
					},
				}),
				"utf8",
			);

			await handleCommand(createContext(tempRoot), "upsert_mcp_server", {
				input: {
					name: "slack",
					previousName: "slack",
					transportType: "streamableHttp",
					url: "https://example.com/mcp",
					disabled: true,
					oauthClient: {
						clientId: "desktop-client",
						clientSecret: "replacement-secret",
						allowedScopes: null,
						loopbackHostname: "localhost",
					},
				},
			});

			const written = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(written.mcpServers.slack.transport.url).toBe(
				"https://example.com/mcp",
			);
			expect(written.mcpServers.slack.oauthClient).toEqual({
				clientId: "desktop-client",
				clientSecret: "replacement-secret",
				loopbackHostname: "localhost",
			});
			expect(written.mcpServers.slack.oauth).toBeUndefined();
		} finally {
			if (previousSettingsPath === undefined) {
				delete process.env.CLINE_MCP_SETTINGS_PATH;
			} else {
				process.env.CLINE_MCP_SETTINGS_PATH = previousSettingsPath;
			}
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("keeps an unchanged enabled remote server enabled when saving metadata", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "desktop-mcp-settings-"));
		const settingsPath = join(tempRoot, "cline_mcp_settings.json");
		const previousSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		try {
			await writeFile(
				settingsPath,
				JSON.stringify({
					mcpServers: {
						linear: {
							transport: {
								type: "streamableHttp",
								url: "http://127.0.0.1:1/mcp",
							},
						},
						broken: {},
					},
				}),
				"utf8",
			);

			const response = (await handleCommand(
				createContext(tempRoot),
				"upsert_mcp_server",
				{
					input: {
						name: "linear",
						previousName: "linear",
						transportType: "streamableHttp",
						url: "http://127.0.0.1:1/mcp",
						disabled: false,
						metadata: { source: "edited" },
					},
				},
			)) as JsonRecord;
			const servers = response.servers as JsonRecord[];
			expect(servers.find((server) => server.name === "linear")).toMatchObject({
				disabled: false,
				metadata: { source: "edited" },
			});
			expect(servers.find((server) => server.name === "broken")).toHaveProperty(
				"configurationError",
			);

			const written = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(written.mcpServers.linear.disabled).toBe(false);
		} finally {
			if (previousSettingsPath === undefined) {
				delete process.env.CLINE_MCP_SETTINGS_PATH;
			} else {
				process.env.CLINE_MCP_SETTINGS_PATH = previousSettingsPath;
			}
			await rm(tempRoot, { recursive: true, force: true });
		}
	});
});
