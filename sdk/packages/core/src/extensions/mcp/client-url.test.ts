import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clientState = vi.hoisted(() => ({
	connectOptions: undefined as unknown,
	listToolsOptions: undefined as unknown,
	callToolOptions: undefined as unknown,
	callToolError: undefined as unknown,
	connectError: undefined as unknown,
	closeCount: 0,
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: class {
		async connect(_transport: unknown, options: unknown): Promise<void> {
			clientState.connectOptions = options;
			if (clientState.connectError) {
				throw clientState.connectError;
			}
		}

		async close(): Promise<void> {
			clientState.closeCount += 1;
		}

		async listTools(_params: unknown, options: unknown) {
			clientState.listToolsOptions = options;
			return { tools: [] };
		}

		async callTool(
			_request: unknown,
			_resultSchema: unknown,
			options: unknown,
		) {
			clientState.callToolOptions = options;
			if (clientState.callToolError) {
				throw clientState.callToolError;
			}
			return { content: [] };
		}
	},
}));

import { createDefaultMcpServerClientFactory } from "./client";

describe("SDK URL MCP client timeout", () => {
	beforeEach(() => {
		clientState.connectOptions = undefined;
		clientState.listToolsOptions = undefined;
		clientState.callToolOptions = undefined;
		clientState.callToolError = undefined;
		clientState.connectError = undefined;
		clientState.closeCount = 0;
	});

	async function createClient(timeoutSeconds = 12) {
		return createDefaultMcpServerClientFactory()({
			name: "remote",
			transport: {
				type: "streamableHttp",
				url: "https://mcp.example.test",
			},
			timeoutSeconds,
		});
	}

	it("uses one timeout snapshot for initialize, list, and call", async () => {
		const client = await createClient();
		const controller = new AbortController();

		await client.connect();
		await client.listTools();
		await client.callTool({
			name: "slow",
			context: {
				agentId: "test-agent",
				iteration: 1,
				signal: controller.signal,
			},
		});

		expect(clientState.connectOptions).toEqual({ timeout: 12_000 });
		expect(clientState.listToolsOptions).toEqual({ timeout: 12_000 });
		expect(clientState.callToolOptions).toEqual({
			timeout: 12_000,
			signal: controller.signal,
		});
	});

	it("adds the effective bound and setting hint to timeout errors", async () => {
		const client = await createClient();
		await client.connect();
		clientState.callToolError = new McpError(
			ErrorCode.RequestTimeout,
			"Request timed out",
		);

		await expect(client.callTool({ name: "slow" })).rejects.toThrow(
			/timed out after 12s.*"timeout" field \(in seconds\)/s,
		);
	});

	it("closes the SDK client when initialize times out", async () => {
		clientState.connectError = new McpError(
			ErrorCode.RequestTimeout,
			"Request timed out",
		);
		const client = await createClient();

		await expect(client.connect()).rejects.toThrow(/timed out after 12s/);
		expect(clientState.closeCount).toBe(1);
	});
});
