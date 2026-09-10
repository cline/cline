import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleCommand } from "./commands";
import {
	attachMcpConnectionStatus,
	buildMcpServersResponse,
	readMcpTimeoutInput,
	shouldProbeMcpServerAfterUpsert,
} from "./mcp";
import type { JsonRecord, SidecarContext } from "./types";

function createContext(workspaceRoot: string): SidecarContext {
	return {
		liveSessions: new Map(),
		restoringWorkspacePaths: new Set(),
		streamIndices: new Map(),
		bootId: "test-boot",
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
					command: "npx",
					args: ["-y", "mcp-remote", "https://mcp.linear.app/mcp"],
					disabled: true,
					oauth: {
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
	});

	it("surfaces the configured timeout and the hub's connect outcome per server", () => {
		const response = buildMcpServersResponse("/tmp/cline_mcp_settings.json", {
			mcpServers: {
				commander: {
					transport: { type: "stdio", command: "npx", args: ["-y", "pkg"] },
					timeout: 60,
				},
				quiet: { transport: { type: "stdio", command: "sleep" } },
				untried: { transport: { type: "stdio", command: "node" } },
			},
		});
		expect((response.servers as JsonRecord[])[0]).toMatchObject({
			name: "commander",
			timeout: 60,
		});

		const withStatus = attachMcpConnectionStatus(response, [
			{
				id: "commander",
				name: "commander",
				path: "/tmp/cline_mcp_settings.json",
				kind: "mcp",
				source: "global",
				connection: { connected: true, toolCount: 27, updatedAt: 1 },
			},
			{
				id: "quiet",
				name: "quiet",
				path: "/tmp/cline_mcp_settings.json",
				kind: "mcp",
				source: "global",
				connection: {
					connected: false,
					error: "initialize timed out after 5s",
					updatedAt: 2,
				},
			},
			{
				id: "untried",
				name: "untried",
				path: "/tmp/cline_mcp_settings.json",
				kind: "mcp",
				source: "global",
			},
		]);
		const servers = withStatus.servers as JsonRecord[];
		expect(servers.find((s) => s.name === "commander")?.connection).toEqual({
			connected: true,
			toolCount: 27,
			updatedAt: 1,
		});
		expect(servers.find((s) => s.name === "quiet")?.connection).toEqual({
			connected: false,
			error: "initialize timed out after 5s",
			updatedAt: 2,
		});
		expect(servers.find((s) => s.name === "untried")).not.toHaveProperty(
			"connection",
		);
	});

	it("validates the editor's timeout input", () => {
		expect(readMcpTimeoutInput(undefined)).toBeUndefined();
		expect(readMcpTimeoutInput("")).toBeUndefined();
		expect(readMcpTimeoutInput(30)).toBe(30);
		expect(readMcpTimeoutInput("45")).toBe(45);
		expect(() => readMcpTimeoutInput("abc")).toThrow(/positive number/);
		expect(() => readMcpTimeoutInput(0)).toThrow(/positive number/);
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

	it("persists the editor's timeout as the settings entry's timeout field", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "desktop-mcp-settings-"));
		const settingsPath = join(tempRoot, "cline_mcp_settings.json");
		const previousSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		try {
			await writeFile(settingsPath, JSON.stringify({ mcpServers: {} }));

			const response = (await handleCommand(
				createContext(tempRoot),
				"upsert_mcp_server",
				{
					input: {
						name: "commander",
						transportType: "stdio",
						command: "npx",
						args: ["-y", "@wonderwhy-er/desktop-commander@latest"],
						disabled: false,
						timeout: 45,
					},
				},
			)) as JsonRecord;
			expect((response.servers as JsonRecord[])[0]).toMatchObject({
				name: "commander",
				timeout: 45,
			});
			let written = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(written.mcpServers.commander.timeout).toBe(45);

			// Clearing the field removes it so the defaults apply again.
			await handleCommand(createContext(tempRoot), "upsert_mcp_server", {
				input: {
					name: "commander",
					previousName: "commander",
					transportType: "stdio",
					command: "npx",
					args: ["-y", "@wonderwhy-er/desktop-commander@latest"],
					disabled: false,
					timeout: "",
				},
			});
			written = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(written.mcpServers.commander).not.toHaveProperty("timeout");
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
