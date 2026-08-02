import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { upsertMcpServer } from "./mcp";
import type { JsonRecord } from "./types";

describe("upsertMcpServer", () => {
	const tempRoots: string[] = [];
	const envSnapshot = {
		CLINE_MCP_SETTINGS_PATH: process.env.CLINE_MCP_SETTINGS_PATH,
	};

	afterEach(async () => {
		if (envSnapshot.CLINE_MCP_SETTINGS_PATH === undefined) {
			delete process.env.CLINE_MCP_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_SETTINGS_PATH = envSnapshot.CLINE_MCP_SETTINGS_PATH;
		}
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	async function seedSettings(servers: JsonRecord): Promise<string> {
		const tempRoot = await mkdtemp(join(tmpdir(), "cline-hub-mcp-"));
		tempRoots.push(tempRoot);
		const settingsPath = join(tempRoot, "cline_mcp_settings.json");
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		writeFileSync(
			settingsPath,
			`${JSON.stringify({ mcpServers: servers }, null, 2)}\n`,
		);
		return settingsPath;
	}

	function readStoredServers(settingsPath: string): JsonRecord {
		const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as JsonRecord;
		return parsed.mcpServers as JsonRecord;
	}

	it("preserves metadata and oauth when an existing server is edited", async () => {
		const settingsPath = await seedSettings({
			docs: {
				transport: { type: "stdio", command: "old-command", args: ["--old"] },
				disabled: false,
				metadata: { source: "marketplace", id: "docs-server" },
				oauth: { tokens: { access_token: "token-123" } },
			},
		});

		upsertMcpServer({
			name: "docs",
			transportType: "stdio",
			command: "new-command",
			args: ["--new"],
		});

		const stored = readStoredServers(settingsPath).docs as JsonRecord;
		expect((stored.transport as JsonRecord).command).toBe("new-command");
		expect(stored.metadata).toEqual({
			source: "marketplace",
			id: "docs-server",
		});
		expect(stored.oauth).toEqual({ tokens: { access_token: "token-123" } });
	});

	it("carries preserved fields across a rename", async () => {
		const settingsPath = await seedSettings({
			docs: {
				transport: { type: "stdio", command: "old-command" },
				disabled: false,
				metadata: { source: "marketplace" },
				oauth: { tokens: { access_token: "token-123" } },
			},
		});

		upsertMcpServer({
			name: "docs-renamed",
			previousName: "docs",
			transportType: "stdio",
			command: "new-command",
		});

		const servers = readStoredServers(settingsPath);
		const renamed = servers["docs-renamed"] as JsonRecord;
		expect(servers.docs).toBeUndefined();
		expect(renamed.metadata).toEqual({ source: "marketplace" });
		expect(renamed.oauth).toEqual({ tokens: { access_token: "token-123" } });
	});

	it("clears legacy flat transport fields when editing a legacy entry", async () => {
		const settingsPath = await seedSettings({
			docs: {
				command: "old-command",
				args: ["--old-a", "--old-b"],
				cwd: "/old/cwd",
				env: { OLD_SECRET: "leftover" },
				disabled: false,
				autoApprove: ["read_file"],
				metadata: { source: "marketplace" },
			},
		});

		upsertMcpServer({
			name: "docs",
			transportType: "stdio",
			command: "new-command",
		});

		const stored = readStoredServers(settingsPath).docs as JsonRecord;
		expect(stored.command).toBeUndefined();
		expect(stored.args).toBeUndefined();
		expect(stored.cwd).toBeUndefined();
		expect(stored.env).toBeUndefined();
		expect((stored.transport as JsonRecord).command).toBe("new-command");
		expect(stored.autoApprove).toEqual(["read_file"]);
		expect(stored.metadata).toEqual({ source: "marketplace" });
	});

	it("drops oauth when a remote server is pointed at a different url", async () => {
		const settingsPath = await seedSettings({
			docs: {
				transport: {
					type: "streamableHttp",
					url: "https://trusted.example.com/mcp",
				},
				disabled: false,
				metadata: { source: "marketplace" },
				oauth: { tokens: { access_token: "token-123" } },
			},
		});

		upsertMcpServer({
			name: "docs",
			transportType: "streamableHttp",
			url: "https://other.example.com/mcp",
		});

		const stored = readStoredServers(settingsPath).docs as JsonRecord;
		expect((stored.transport as JsonRecord).url).toBe(
			"https://other.example.com/mcp",
		);
		expect(stored.oauth).toBeUndefined();
		expect(stored.metadata).toEqual({ source: "marketplace" });
	});

	it("keeps oauth when a remote server keeps the same url", async () => {
		const settingsPath = await seedSettings({
			docs: {
				transport: {
					type: "streamableHttp",
					url: "https://trusted.example.com/mcp",
					headers: { "X-Old": "1" },
				},
				disabled: false,
				oauth: { tokens: { access_token: "token-123" } },
			},
		});

		upsertMcpServer({
			name: "docs",
			transportType: "streamableHttp",
			url: "https://trusted.example.com/mcp",
			headers: { "X-New": "2" },
		});

		const stored = readStoredServers(settingsPath).docs as JsonRecord;
		expect(stored.oauth).toEqual({ tokens: { access_token: "token-123" } });
	});

	it("applies a metadata edit supplied by the caller", async () => {
		const settingsPath = await seedSettings({
			docs: {
				transport: { type: "stdio", command: "old-command" },
				disabled: false,
				metadata: { source: "marketplace" },
			},
		});

		upsertMcpServer({
			name: "docs",
			transportType: "stdio",
			command: "old-command",
			metadata: { source: "hand-edited", note: "user typed this" },
		});

		const stored = readStoredServers(settingsPath).docs as JsonRecord;
		expect(stored.metadata).toEqual({
			source: "hand-edited",
			note: "user typed this",
		});
	});

	it("preserves metadata when the caller omits it", async () => {
		const settingsPath = await seedSettings({
			docs: {
				transport: { type: "stdio", command: "old-command" },
				disabled: false,
				metadata: { source: "marketplace" },
			},
		});

		upsertMcpServer({
			name: "docs",
			transportType: "stdio",
			command: "new-command",
		});

		const stored = readStoredServers(settingsPath).docs as JsonRecord;
		expect(stored.metadata).toEqual({ source: "marketplace" });
	});

	it("clears metadata when the caller sends null", async () => {
		const settingsPath = await seedSettings({
			docs: {
				transport: { type: "stdio", command: "old-command" },
				disabled: false,
				metadata: { source: "marketplace" },
				oauth: { tokens: { access_token: "token-123" } },
			},
		});

		upsertMcpServer({
			name: "docs",
			transportType: "stdio",
			command: "old-command",
			metadata: null,
		});

		const stored = readStoredServers(settingsPath).docs as JsonRecord;
		expect("metadata" in stored).toBe(false);
		expect(stored.oauth).toEqual({ tokens: { access_token: "token-123" } });
	});

	it("rejects metadata that is not a JSON object", async () => {
		const settingsPath = await seedSettings({
			docs: {
				transport: { type: "stdio", command: "old-command" },
				disabled: false,
				metadata: { source: "marketplace" },
			},
		});

		for (const invalid of [[], 42, "text", true]) {
			expect(() =>
				upsertMcpServer({
					name: "docs",
					transportType: "stdio",
					command: "new-command",
					metadata: invalid,
				}),
			).toThrow(/metadata must be a JSON object/);
		}

		const stored = readStoredServers(settingsPath).docs as JsonRecord;
		expect((stored.transport as JsonRecord).command).toBe("old-command");
		expect(stored.metadata).toEqual({ source: "marketplace" });
	});

	it("keeps oauth when a legacy http entry keeps the same url", async () => {
		const settingsPath = await seedSettings({
			docs: {
				transportType: "http",
				url: "https://trusted.example.com/mcp",
				disabled: false,
				oauth: { tokens: { access_token: "token-123" } },
			},
		});

		upsertMcpServer({
			name: "docs",
			transportType: "streamableHttp",
			url: "https://trusted.example.com/mcp",
		});

		const stored = readStoredServers(settingsPath).docs as JsonRecord;
		expect(stored.oauth).toEqual({ tokens: { access_token: "token-123" } });
		expect((stored.transport as JsonRecord).type).toBe("streamableHttp");
		expect(stored.transportType).toBeUndefined();
	});

	it("leaves no stdio remnant when a server switches to sse", async () => {
		const settingsPath = await seedSettings({
			docs: {
				transport: { type: "stdio", command: "old-command", args: ["--old"] },
				disabled: false,
				metadata: { source: "marketplace" },
			},
		});

		upsertMcpServer({
			name: "docs",
			transportType: "sse",
			url: "https://example.com/sse",
		});

		const stored = readStoredServers(settingsPath).docs as JsonRecord;
		const transport = stored.transport as JsonRecord;
		expect(transport.type).toBe("sse");
		expect(transport.url).toBe("https://example.com/sse");
		expect(transport.command).toBeUndefined();
		expect(transport.args).toBeUndefined();
		expect(stored.metadata).toEqual({ source: "marketplace" });
	});
});
