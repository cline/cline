import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HUB_DEFAULT_COMMAND_TIMEOUT_MS } from "@cline/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createDefaultMcpServerClientFactory,
	DEFAULT_MCP_CONNECT_TIMEOUT_MS,
	probeMcpServerConnection,
} from "./client";
import {
	createMcpServerFixture,
	fakeServerRegistration,
	type McpServerFixture,
} from "./client-test-fixtures";

/**
 * Integration tests for MCP client request timeouts against a real stdio
 * child process. The fake server is a Node script speaking newline-delimited
 * JSON-RPC with an env-controlled response delay, so the tests cross the
 * actual process/stdio boundary where the timeout risk lives.
 *
 * Connect-budget and initialize-failure cases live in client-connect.test.ts
 * and client-init-failure.test.ts so their real delays run in parallel forks.
 */

let fixture: McpServerFixture;
let tempRoot: string;

beforeAll(() => {
	fixture = createMcpServerFixture();
	tempRoot = fixture.tempRoot;
});

afterAll(() => {
	fixture.cleanup();
});

describe("mcp client request timeout", () => {
	it("lets a slow server respond beyond the old 5s default when configured higher", async () => {
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration(tempRoot, { timeoutSeconds: 30, delayMs: 6_000 }),
		);
		try {
			await client.connect();
			const tools = await client.listTools();
			expect(tools).toEqual([]);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("times out with a message naming the bound and the field to change", async () => {
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration(tempRoot, { timeoutSeconds: 1, delayMs: 5_000 }),
		);
		try {
			await client.connect();
			await expect(client.callTool({ name: "anything" })).rejects.toThrow(
				/request to "fake-server" \(tools\/call\) timed out after 1s.*"timeout" field \(in seconds\)/s,
			);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("aborts a long stdio tool call without waiting for its timeout", async () => {
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration(tempRoot, { timeoutSeconds: 30, delayMs: 10_000 }),
		);
		const controller = new AbortController();
		try {
			await client.connect();
			const call = client.callTool({
				name: "anything",
				context: {
					agentId: "test-agent",
					iteration: 1,
					signal: controller.signal,
				},
			});
			controller.abort();
			await expect(call).rejects.toMatchObject({ name: "AbortError" });
		} finally {
			await client.disconnect();
		}
	}, 30_000);
});

describe("remote MCP OAuth connection", () => {
	it("reports authorization required without starting an interactive OAuth flow", async () => {
		const settingsPath = join(tempRoot, "remote-oauth-settings.json");
		writeFileSync(
			settingsPath,
			JSON.stringify({
				mcpServers: {
					github: {
						transport: {
							type: "streamableHttp",
							url: "https://api.githubcopilot.com/mcp/",
						},
					},
				},
			}),
			"utf8",
		);
		const fetchMock = vi.fn(async () =>
			Promise.resolve(
				new Response(null, {
					status: 401,
					headers: { "www-authenticate": "Bearer" },
				}),
			),
		);
		const result = await probeMcpServerConnection({
			serverName: "github",
			filePath: settingsPath,
			fetch: fetchMock,
		});

		expect(result).toMatchObject({
			serverName: "github",
			connected: false,
			authorizationRequired: true,
			error: expect.stringMatching(
				/MCP server "github" requires OAuth authorization/,
			),
		});

		const written = JSON.parse(readFileSync(settingsPath, "utf8"));
		expect(written.mcpServers.github.oauth).toMatchObject({
			authorizationRequired: true,
		});
		expect(written.mcpServers.github.oauth).not.toHaveProperty("codeVerifier");
		expect(written.mcpServers.github.oauth).not.toHaveProperty(
			"discoveryState",
		);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("surfaces a rejected static Authorization header as a connection error", async () => {
		const settingsPath = join(tempRoot, "remote-static-auth-settings.json");
		writeFileSync(
			settingsPath,
			JSON.stringify({
				mcpServers: {
					notion: {
						transport: {
							type: "streamableHttp",
							url: "https://mcp.notion.com/mcp",
							headers: { Authorization: "Bearer token" },
						},
					},
				},
			}),
			"utf8",
		);

		const result = await probeMcpServerConnection({
			serverName: "notion",
			filePath: settingsPath,
			fetch: async () =>
				new Response(null, {
					status: 401,
					headers: { "www-authenticate": "Bearer" },
				}),
		});

		expect(result).toEqual({
			serverName: "notion",
			connected: false,
			authorizationRequired: false,
			error:
				'MCP server "notion" rejected its configured Authorization header. Update or remove that header before connecting with OAuth.',
		});
	});
});

describe("default connect budget", () => {
	it("keeps the doubled initialize budget well under the hub command timeout", () => {
		// MCP initialize runs on the session.create critical path, and connect()
		// can spend the budget twice (newline then Content-Length framing). If
		// the doubled total approaches HUB_DEFAULT_COMMAND_TIMEOUT_MS, a server
		// that never initializes stalls session.create past the hub deadline and
		// the whole session is torn down (a hung server used to kill the CLI
		// this way). Keep headroom for the rest of session creation.
		expect(DEFAULT_MCP_CONNECT_TIMEOUT_MS * 2).toBeLessThanOrEqual(
			HUB_DEFAULT_COMMAND_TIMEOUT_MS / 2,
		);
	});
});
