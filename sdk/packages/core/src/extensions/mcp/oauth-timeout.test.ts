import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const clientState = vi.hoisted(() => ({
	connectOptions: [] as unknown[],
	listToolsOptions: [] as unknown[],
	authResults: [] as string[],
}));

vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
	UnauthorizedError: class UnauthorizedError extends Error {},
	auth: async (provider: {
		state?: () => string;
		redirectToAuthorization: (url: URL) => Promise<void>;
	}) => {
		const state = provider.state?.();
		await provider.redirectToAuthorization(
			new URL(`https://auth.example.test/authorize?state=${state}`),
		);
		clientState.authResults.push("REDIRECT");
		return "REDIRECT";
	},
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
	StreamableHTTPClientTransport: class {
		async finishAuth(_code: string): Promise<void> {}
	},
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: class {
		async connect(_transport: unknown, options: unknown): Promise<void> {
			clientState.connectOptions.push(options);
		}

		async listTools(_params: unknown, options: unknown) {
			clientState.listToolsOptions.push(options);
			return { tools: [] };
		}

		async close(): Promise<void> {}
	},
}));

import { authorizeMcpServerOAuth } from "./oauth";

describe("interactive MCP OAuth timeout", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		clientState.connectOptions.length = 0;
		clientState.listToolsOptions.length = 0;
		clientState.authResults.length = 0;
		await Promise.all(
			tempRoots.map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
		tempRoots.length = 0;
	});

	it("uses the registration timeout for the authorization probe", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-oauth-timeout-"));
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
						timeout: 12,
						oauth: {
							clientInformation: { client_id: "client" },
							tokens: {
								access_token: "token",
								token_type: "Bearer",
							},
						},
					},
				},
			}),
			"utf8",
		);

		await authorizeMcpServerOAuth({
			serverName: "remote",
			filePath,
			callbackPorts: [0],
		});

		expect(clientState.connectOptions).toEqual([{ timeout: 12_000 }]);
		expect(clientState.listToolsOptions).toEqual([{ timeout: 12_000 }]);
	});
	it("starts OAuth when a public catalog succeeds without tokens", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-oauth-public-"));
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
		let callbackUrl: string | undefined;
		const portProbe = createServer();
		portProbe.listen(0, "127.0.0.1");
		await new Promise<void>((resolve) => portProbe.once("listening", resolve));
		const address = portProbe.address();
		if (!address || typeof address === "string") {
			throw new Error("Could not reserve a local callback test port.");
		}
		const callbackPort = address.port;
		await new Promise<void>((resolve, reject) =>
			portProbe.close((error) => (error ? reject(error) : resolve())),
		);
		const resultPromise = authorizeMcpServerOAuth({
			serverName: "remote",
			filePath,
			callbackPorts: [callbackPort],
			openUrl: async (url) => {
				if (!callbackUrl) {
					throw new Error("Callback listener is not ready.");
				}
				const state = new URL(url).searchParams.get("state");
				get(`${callbackUrl}?code=public-catalog&state=${state}`, (response) => {
					response.resume();
				}).on("error", () => {});
			},
			onServerListening: (info) => {
				callbackUrl = info.callbackUrl;
			},
		});

		await expect(resultPromise).resolves.toMatchObject({
			authorized: true,
			message: 'MCP server "remote" OAuth authorization completed.',
		});
		expect(clientState.authResults).toEqual(["REDIRECT"]);
		expect(clientState.connectOptions).toHaveLength(2);
		expect(clientState.listToolsOptions).toHaveLength(2);
	});
	it("closes its callback listener when cancelled before OAuth state initialization", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "mcp-oauth-cancel-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify({
				mcpServers: {
					remote: {
						transport: {
							type: "streamableHttp",
							url: "https://example.test/mcp",
						},
					},
				},
			}),
		);
		const controller = new AbortController();
		const onClose = vi.fn();
		await expect(
			authorizeMcpServerOAuth({
				serverName: "remote",
				filePath,
				callbackPorts: [0],
				signal: controller.signal,
				onServerListening: () => controller.abort(),
				onServerClose: onClose,
			}),
		).rejects.toThrow("cancelled");
		expect(onClose).toHaveBeenCalledOnce();
		expect(clientState.connectOptions).toEqual([]);
	});
});
