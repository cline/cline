import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const clientState = vi.hoisted(() => ({
	connectCalls: 0,
	finishAuthCodes: [] as string[],
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: class {
		async connect(transport: {
			authProvider?: {
				state?: () => string | Promise<string>;
				redirectToAuthorization: (url: URL) => void | Promise<void>;
				clientInformation?: () =>
					| { client_id: string }
					| undefined
					| Promise<{ client_id: string } | undefined>;
				saveClientInformation?: (information: {
					client_id: string;
				}) => void | Promise<void>;
			};
		}): Promise<void> {
			clientState.connectCalls += 1;
			if (clientState.connectCalls !== 1) {
				return;
			}
			const provider = transport.authProvider;
			if (!provider?.state) {
				throw new Error("Expected an OAuth provider with state support.");
			}
			if (
				!(await provider.clientInformation?.()) &&
				provider.saveClientInformation
			) {
				await provider.saveClientInformation({
					client_id: "dynamically-registered-client",
				});
			}
			const state = await provider.state();
			const authorizationUrl = new URL(
				"https://authorization.example.test/authorize",
			);
			authorizationUrl.searchParams.set("state", state);
			await provider.redirectToAuthorization(authorizationUrl);
			const { UnauthorizedError } = await import(
				"@modelcontextprotocol/sdk/client/auth.js"
			);
			throw new UnauthorizedError("Authorization required");
		}

		async listTools(): Promise<{ tools: never[] }> {
			return { tools: [] };
		}

		async close(): Promise<void> {}
	},
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
	StreamableHTTPClientTransport: class {
		readonly authProvider?: {
			saveTokens: (tokens: {
				access_token: string;
				token_type: string;
			}) => void | Promise<void>;
		};

		constructor(
			_url: URL,
			options: {
				authProvider?: {
					saveTokens: (tokens: {
						access_token: string;
						token_type: string;
					}) => void | Promise<void>;
				};
			},
		) {
			this.authProvider = options.authProvider;
		}

		async finishAuth(code: string): Promise<void> {
			clientState.finishAuthCodes.push(code);
			await this.authProvider?.saveTokens({
				access_token: `token-for-${code}`,
				token_type: "bearer",
			});
		}
	},
}));

import { startLocalOAuthServer } from "../../auth/server";
import { updateMcpSettingsFile } from "./config-loader";
import { authorizeMcpServerOAuth } from "./oauth";

const socketBindingSupported = await (async () => {
	try {
		const server = net.createServer();
		await new Promise<void>((resolve, reject) => {
			server.listen(0, "127.0.0.1", resolve);
			server.once("error", reject);
		});
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		return true;
	} catch {
		return false;
	}
})();
const socketIt = socketBindingSupported ? it : it.skip;

function getFreePort(host = "127.0.0.1"): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.listen(0, host, () => {
			const address = server.address() as net.AddressInfo;
			server.close(() => resolve(address.port));
		});
		server.on("error", reject);
	});
}

function get(url: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		http
			.get(url, (response) => {
				let body = "";
				response.on("data", (chunk: Buffer) => {
					body += chunk.toString();
				});
				response.on("end", () =>
					resolve({ status: response.statusCode ?? 0, body }),
				);
			})
			.on("error", reject);
	});
}

describe("interactive MCP OAuth callback validation", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		clientState.connectCalls = 0;
		clientState.finishAuthCodes.length = 0;
		await Promise.all(
			tempRoots.map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
		tempRoots.length = 0;
	});

	it("rejects a callbackHost that conflicts with configured localhost identity", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-oauth-conflict-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify({
				mcpServers: {
					remote: {
						transport: {
							type: "streamableHttp",
							url: "https://mcp.example.test",
						},
						oauthClient: {
							clientId: "static-client",
							loopbackHostname: "localhost",
						},
					},
				},
			}),
			"utf8",
		);

		await expect(
			authorizeMcpServerOAuth({
				serverName: "remote",
				filePath,
				callbackHost: "127.0.0.1",
				callbackPorts: [1456],
			}),
		).rejects.toThrow(
			'resolves oauthClient.loopbackHostname to "localhost"; callbackHost must match it',
		);
		expect(clientState.connectCalls).toBe(0);
	});

	it("rejects localhost callbackHost for an explicit IPv4 loopback identity", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-oauth-conflict-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify({
				mcpServers: {
					remote: {
						transport: {
							type: "streamableHttp",
							url: "https://mcp.example.test",
						},
						oauthClient: {
							clientId: "static-client",
							loopbackHostname: "127.0.0.1",
						},
					},
				},
			}),
			"utf8",
		);

		await expect(
			authorizeMcpServerOAuth({
				serverName: "remote",
				filePath,
				callbackHost: "localhost",
				callbackPorts: [1456],
			}),
		).rejects.toThrow(
			'resolves oauthClient.loopbackHostname to "127.0.0.1"; callbackHost must match it',
		);
		expect(clientState.connectCalls).toBe(0);
	});

	it("rejects localhost callbackHost for a static client's default IPv4 identity", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-oauth-conflict-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify({
				mcpServers: {
					remote: {
						transport: {
							type: "streamableHttp",
							url: "https://mcp.example.test",
						},
						oauthClient: { clientId: "static-client" },
					},
				},
			}),
			"utf8",
		);

		await expect(
			authorizeMcpServerOAuth({
				serverName: "remote",
				filePath,
				callbackHost: "localhost",
				callbackPorts: [1456],
			}),
		).rejects.toThrow(
			'resolves oauthClient.loopbackHostname to "127.0.0.1"; callbackHost must match it',
		);
		expect(clientState.connectCalls).toBe(0);
	});

	socketIt(
		"keeps waiting through premature and wrong-state callbacks",
		async () => {
			const tempRoot = await mkdtemp(
				join(tmpdir(), "core-mcp-oauth-callback-"),
			);
			tempRoots.push(tempRoot);
			const filePath = join(tempRoot, "cline_mcp_settings.json");
			await writeFile(
				filePath,
				JSON.stringify({
					mcpServers: {
						remote: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.example.test",
							},
							oauthClient: { clientId: "static-client" },
						},
					},
				}),
				"utf8",
			);
			const port = await getFreePort();
			const callbackUrl = `http://127.0.0.1:${port}/callback`;
			let prematureResponse: { status: number; body: string } | undefined;

			const result = await authorizeMcpServerOAuth({
				serverName: "remote",
				filePath,
				callbackPorts: [port],
				callbackPath: "/callback",
				onServerListening: async () => {
					prematureResponse = await get(
						`${callbackUrl}?code=premature&state=unknown`,
					);
				},
				openUrl: async (url) => {
					const expectedState = new URL(url).searchParams.get("state");
					expect(expectedState).toBeTruthy();

					for (const query of [
						"error=access_denied&state=wrong-state",
						"code=wrong-code&state=wrong-state",
					]) {
						expect(await get(`${callbackUrl}?${query}`)).toEqual({
							status: 400,
							body: "State mismatch",
						});
					}

					expect(
						await get(
							`${callbackUrl}?code=valid-code&state=${encodeURIComponent(expectedState ?? "")}`,
						),
					).toMatchObject({ status: 200 });
				},
			});

			expect(prematureResponse).toEqual({
				status: 400,
				body: "OAuth callback state is not ready",
			});
			expect(result.authorized).toBe(true);
			expect(clientState.connectCalls).toBe(2);
			expect(clientState.finishAuthCodes).toEqual(["valid-code"]);
		},
	);

	socketIt(
		"preserves configured localhost identity with an explicit localhost callbackHost",
		async () => {
			const tempRoot = await mkdtemp(
				join(tmpdir(), "core-mcp-oauth-localhost-"),
			);
			tempRoots.push(tempRoot);
			const filePath = join(tempRoot, "cline_mcp_settings.json");
			await writeFile(
				filePath,
				JSON.stringify({
					mcpServers: {
						remote: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.example.test",
							},
							oauthClient: {
								clientId: "static-client",
								loopbackHostname: "localhost",
							},
						},
					},
				}),
				"utf8",
			);
			const port = await getFreePort("localhost");
			const callbackUrl = `http://localhost:${port}/callback`;

			const result = await authorizeMcpServerOAuth({
				serverName: "remote",
				filePath,
				callbackHost: "localhost",
				callbackPorts: [port],
				callbackPath: "/callback",
				onServerListening: (info) => {
					expect(info).toEqual({
						host: "localhost",
						port,
						callbackUrl,
					});
				},
				openUrl: async (url) => {
					const expectedState = new URL(url).searchParams.get("state");
					expect(expectedState).toBeTruthy();
					expect(
						await get(
							`${callbackUrl}?code=valid-code&state=${encodeURIComponent(expectedState ?? "")}`,
						),
					).toMatchObject({ status: 200 });
				},
			});

			expect(result.authorized).toBe(true);
			const written = JSON.parse(await readFile(filePath, "utf8"));
			expect(written.mcpServers.remote.oauth.loopbackHostname).toBe(
				"localhost",
			);
		},
	);

	socketIt(
		"binds a dynamic client's state to its explicit localhost callback identity",
		async () => {
			const tempRoot = await mkdtemp(
				join(tmpdir(), "core-mcp-oauth-dynamic-localhost-"),
			);
			tempRoots.push(tempRoot);
			const filePath = join(tempRoot, "cline_mcp_settings.json");
			await writeFile(
				filePath,
				JSON.stringify({
					mcpServers: {
						remote: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.example.test",
							},
						},
					},
				}),
				"utf8",
			);
			const port = await getFreePort("localhost");
			const callbackUrl = `http://localhost:${port}/callback`;

			const result = await authorizeMcpServerOAuth({
				serverName: "remote",
				filePath,
				callbackHost: "localhost",
				callbackPorts: [port],
				callbackPath: "/callback",
				openUrl: async (url) => {
					const expectedState = new URL(url).searchParams.get("state");
					expect(expectedState).toBeTruthy();
					expect(
						await get(
							`${callbackUrl}?code=valid-code&state=${encodeURIComponent(expectedState ?? "")}`,
						),
					).toMatchObject({ status: 200 });
				},
			});

			expect(result.authorized).toBe(true);
			const written = JSON.parse(await readFile(filePath, "utf8"));
			expect(written.mcpServers.remote.oauth.loopbackHostname).toBe(
				"localhost",
			);
		},
	);

	socketIt(
		"closes the callback listener when transport changes before interactive reset",
		async () => {
			const tempRoot = await mkdtemp(
				join(tmpdir(), "core-mcp-oauth-transport-reset-"),
			);
			tempRoots.push(tempRoot);
			const filePath = join(tempRoot, "cline_mcp_settings.json");
			await writeFile(
				filePath,
				JSON.stringify({
					mcpServers: {
						remote: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.example.test",
							},
							oauthClient: { clientId: "static-client" },
						},
					},
				}),
				"utf8",
			);
			const port = await getFreePort();

			await expect(
				authorizeMcpServerOAuth({
					serverName: "remote",
					filePath,
					callbackPorts: [port],
					callbackPath: "/callback",
					onServerListening: async () => {
						await updateMcpSettingsFile(filePath, (settings) => {
							const remote = (settings.mcpServers as Record<string, unknown>)
								.remote as { transport: { url: string } };
							remote.transport.url = "https://replacement.example.test/mcp";
						});
					},
				}),
			).rejects.toThrow("transport configuration changed while authorizing");

			const rebound = await startLocalOAuthServer({
				ports: [port],
				callbackPath: "/callback",
				timeoutMs: 1_000,
			});
			rebound.close();
		},
	);

	socketIt(
		"rejects token persistence when transport changes during the browser callback",
		async () => {
			const tempRoot = await mkdtemp(
				join(tmpdir(), "core-mcp-oauth-transport-callback-"),
			);
			tempRoots.push(tempRoot);
			const filePath = join(tempRoot, "cline_mcp_settings.json");
			await writeFile(
				filePath,
				JSON.stringify({
					mcpServers: {
						remote: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.example.test",
							},
							oauthClient: { clientId: "static-client" },
						},
					},
				}),
				"utf8",
			);
			const port = await getFreePort();
			const callbackUrl = `http://127.0.0.1:${port}/callback`;
			let publishAuthorizationUrl: (url: string) => void = () => {};
			const authorizationUrl = new Promise<string>((resolve) => {
				publishAuthorizationUrl = resolve;
			});
			const authorization = authorizeMcpServerOAuth({
				serverName: "remote",
				filePath,
				callbackPorts: [port],
				callbackPath: "/callback",
				openUrl: (url) => publishAuthorizationUrl(url),
			});
			const rejectedAuthorization = expect(authorization).rejects.toThrow(
				"transport configuration changed while authorizing",
			);
			const expectedState = new URL(await authorizationUrl).searchParams.get(
				"state",
			);
			await vi.waitFor(async () => {
				const written = JSON.parse(await readFile(filePath, "utf8"));
				expect(written.mcpServers.remote.oauth.authorizationRequired).toBe(
					true,
				);
			});
			await updateMcpSettingsFile(filePath, (settings) => {
				const remote = (settings.mcpServers as Record<string, unknown>)
					.remote as {
					transport: { headers?: Record<string, string> };
				};
				remote.transport.headers = { "X-Tenant": "replacement" };
			});
			expect(
				await get(
					`${callbackUrl}?code=stale-code&state=${encodeURIComponent(expectedState ?? "")}`,
				),
			).toMatchObject({ status: 200 });

			await rejectedAuthorization;

			const written = JSON.parse(await readFile(filePath, "utf8"));
			expect(written.mcpServers.remote.oauth.tokens).toBeUndefined();
			expect(clientState.finishAuthCodes).toEqual(["stale-code"]);
		},
	);
});
