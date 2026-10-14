import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const clientState = vi.hoisted(() => ({
	connectOptions: [] as unknown[],
	listToolsOptions: [] as unknown[],
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
});
