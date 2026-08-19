import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleCommand } from "./commands";
import {
	buildMcpServersResponse,
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
});
