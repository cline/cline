import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildMcpInstallTransport,
	installMcpServer,
	parseMcpInstallArgs,
} from "./mcp-install";

describe("MCP install service", () => {
	let root = "";

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "core-mcp-install-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function readSettings(settingsPath: string): Record<string, unknown> & {
		mcpServers?: Record<string, { transport?: unknown }>;
	} {
		return JSON.parse(readFileSync(settingsPath, "utf8")) as Record<
			string,
			unknown
		> & {
			mcpServers?: Record<string, { transport?: unknown }>;
		};
	}

	it("builds stdio installs without shell-joining command args", () => {
		expect(
			buildMcpInstallTransport({
				name: "fs",
				targetArgs: [
					"npx",
					"-y",
					"@modelcontextprotocol/server-filesystem",
					"/tmp/my dir",
				],
			}),
		).toEqual({
			name: "fs",
			transport: {
				type: "stdio",
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/my dir"],
			},
			warnings: [],
		});
	});

	it("installs remote MCP servers with headers into the settings file", () => {
		const settingsPath = join(root, "cline_mcp_settings.json");
		const result = installMcpServer({
			name: "docs",
			transport: "http",
			headers: ["Authorization: Bearer <token>"],
			targetArgs: ["https://example.com/mcp", "--header=X-Extra: yes"],
			settingsPath,
		});

		expect(result).toEqual({
			name: "docs",
			status: "installed",
			transport: {
				type: "streamableHttp",
				url: "https://example.com/mcp",
				headers: {
					Authorization: "Bearer <token>",
					"X-Extra": "yes",
				},
			},
			warnings: [
				'Header "Authorization" looks like it contains a placeholder. Update it in MCP settings before using this server.',
			],
		});
		expect(readSettings(settingsPath).mcpServers?.docs).toEqual({
			transport: result.transport,
		});
	});

	it("parses marketplace-style MCP install args in core", () => {
		expect(
			parseMcpInstallArgs([
				"docs",
				"--transport=http",
				"https://example.com/mcp",
				"--header",
				"Authorization: Bearer <token>",
				"--header=X-Extra: yes",
			]),
		).toEqual({
			name: "docs",
			transport: "http",
			targetArgs: ["https://example.com/mcp"],
			headers: ["Authorization: Bearer <token>", "X-Extra: yes"],
		});

		expect(() => parseMcpInstallArgs([])).toThrow(
			/Marketplace MCP install args/,
		);
	});

	it("keeps transport-like values as stdio command args for direct builder input", () => {
		expect(
			buildMcpInstallTransport({
				name: "custom",
				targetArgs: ["node", "server.js", "--transport", "ipc"],
			}).transport,
		).toEqual({
			type: "stdio",
			command: "node",
			args: ["server.js", "--transport", "ipc"],
		});
	});

	it("preserves existing MCP settings while adding a server", () => {
		const settingsPath = join(root, "cline_mcp_settings.json");
		writeFileSync(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						existing: {
							transport: { type: "stdio", command: "node" },
							disabled: true,
						},
					},
					customTopLevelKey: true,
				},
				null,
				2,
			),
			"utf8",
		);

		installMcpServer({
			name: "new-server",
			targetArgs: ["node", "server.js"],
			settingsPath,
		});

		const written = readSettings(settingsPath);
		expect(written.customTopLevelKey).toBe(true);
		expect(written.mcpServers).toMatchObject({
			existing: {
				transport: { type: "stdio", command: "node" },
				disabled: true,
			},
			"new-server": {
				transport: {
					type: "stdio",
					command: "node",
					args: ["server.js"],
				},
			},
		});
	});

	it("creates a missing settings file on first install", () => {
		const settingsPath = join(root, "nested", "settings.json");

		installMcpServer({
			name: "fs",
			targetArgs: ["node", "server.js"],
			settingsPath,
		});

		expect(existsSync(settingsPath)).toBe(true);
		expect(readSettings(settingsPath).mcpServers?.fs).toEqual({
			transport: {
				type: "stdio",
				command: "node",
				args: ["server.js"],
			},
		});
	});

	it("rejects invalid install arguments before writing settings", () => {
		const settingsPath = join(root, "settings.json");

		expect(() =>
			installMcpServer({
				name: "fs",
				settingsPath,
			}),
		).toThrow(/requires a command/);
		expect(() =>
			installMcpServer({
				name: "bad",
				transport: "http",
				targetArgs: ["file:///tmp/server"],
				settingsPath,
			}),
		).toThrow(/only http and https are supported/);
		expect(existsSync(settingsPath)).toBe(false);
	});
});
