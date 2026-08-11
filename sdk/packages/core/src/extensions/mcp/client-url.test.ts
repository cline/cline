import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeSseError(code: number | undefined, message: string): SseError {
	return new SseError(
		code,
		message,
		new Event("error") as ConstructorParameters<typeof SseError>[2],
	);
}

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
import { listMcpServerOAuthStatuses } from "./config-loader";

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

describe("SDK URL MCP client authorization persistence", () => {
	const tempRoots: string[] = [];

	beforeEach(() => {
		clientState.connectError = undefined;
	});

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
		tempRoots.length = 0;
	});

	async function connectWithError(
		transportType: "sse" | "streamableHttp",
		connectError: unknown,
	): Promise<{ settingsPath: string; rejection: Promise<void> }> {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-client-url-"));
		tempRoots.push(tempRoot);
		const settingsPath = join(tempRoot, "cline_mcp_settings.json");
		const transport = {
			type: transportType,
			url: "https://mcp.example.test",
		} as const;
		await writeFile(
			settingsPath,
			JSON.stringify({ mcpServers: { linear: { transport } } }),
			"utf8",
		);
		clientState.connectError = connectError;
		const client = await createDefaultMcpServerClientFactory({ settingsPath })({
			name: "linear",
			transport,
		});
		return { settingsPath, rejection: client.connect() };
	}

	it("persists authorization-required when the SSE stream reports a 401", async () => {
		const { settingsPath, rejection } = await connectWithError(
			"sse",
			makeSseError(401, "Non-200 status code (401)"),
		);

		await expect(rejection).rejects.toThrow(/requires OAuth authorization/);
		expect(
			listMcpServerOAuthStatuses({ filePath: settingsPath })[0],
		).toMatchObject({ authorizationRequired: true });
	});

	it("persists authorization-required for typed streamable HTTP 401s", async () => {
		const { settingsPath, rejection } = await connectWithError(
			"streamableHttp",
			new UnauthorizedError("MCP server requires authorization"),
		);

		await expect(rejection).rejects.toThrow(/requires OAuth authorization/);
		expect(
			listMcpServerOAuthStatuses({ filePath: settingsPath })[0],
		).toMatchObject({ authorizationRequired: true });
	});

	it("keeps non-401 SSE failures as plain connection errors", async () => {
		const { settingsPath, rejection } = await connectWithError(
			"sse",
			makeSseError(404, "Non-200 status code (404)"),
		);

		await expect(rejection).rejects.toThrow(/Non-200 status code \(404\)/);
		expect(
			listMcpServerOAuthStatuses({ filePath: settingsPath })[0],
		).toMatchObject({
			authorizationRequired: false,
			lastError: "SSE error: Non-200 status code (404)",
		});
	});
});
