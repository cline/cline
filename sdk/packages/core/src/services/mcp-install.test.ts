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
	uninstallMcpServer,
} from "./mcp-install";

function readSettings(settingsPath: string): Record<string, unknown> & {
	mcpServers?: Record<string, { oauthClient?: unknown; transport?: unknown }>;
} {
	return JSON.parse(readFileSync(settingsPath, "utf8")) as Record<
		string,
		unknown
	> & {
		mcpServers?: Record<string, { oauthClient?: unknown; transport?: unknown }>;
	};
}

describe("MCP install service", () => {
	let root = "";

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "core-mcp-install-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

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

	it("installs mcp-remote marketplace entries as native HTTP servers", () => {
		expect(
			buildMcpInstallTransport({
				name: "linear",
				targetArgs: ["npx", "-y", "mcp-remote", "https://mcp.linear.app/mcp"],
			}),
		).toEqual({
			name: "linear",
			transport: {
				type: "streamableHttp",
				url: "https://mcp.linear.app/mcp",
			},
			warnings: [],
		});
	});

	it("applies OAuth policy after resolving legacy mcp-remote entries", () => {
		// Current marketplace data can still use the legacy proxy command shape;
		// it must receive the same policy as an explicitly remote declaration.
		expect(
			buildMcpInstallTransport(
				parseMcpInstallArgs([
					"linear",
					"--oauth-client-id=public-client",
					"--oauth-allowed-scope=write",
					"--oauth-allowed-scope=read",
					"--header",
					"X-Tenant: public",
					"--",
					"npx",
					"-y",
					"mcp-remote",
					"https://mcp.linear.app/mcp",
				]),
			),
		).toEqual({
			name: "linear",
			oauthClient: {
				clientId: "public-client",
				allowedScopes: ["read", "write"],
			},
			transport: {
				type: "streamableHttp",
				url: "https://mcp.linear.app/mcp",
				headers: { "X-Tenant": "public" },
			},
			warnings: [],
		});
	});

	it("installs remote MCP servers with headers into the settings file", () => {
		const settingsPath = join(root, "cline_mcp_settings.json");
		const result = installMcpServer({
			name: "docs",
			transport: "http",
			headers: ["Authorization: Bearer <token>", "X-Extra: yes"],
			targetArgs: ["https://example.com/mcp"],
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

	it("preserves the legacy Desktop Marketplace -t transport alias", () => {
		const parsed = parseMcpInstallArgs([
			"docs",
			"-t",
			"http",
			"https://example.com/mcp",
		]);
		expect(parsed).toEqual({
			name: "docs",
			transport: "http",
			targetArgs: ["https://example.com/mcp"],
			headers: [],
		});
		expect(buildMcpInstallTransport(parsed).transport).toEqual({
			type: "streamableHttp",
			url: "https://example.com/mcp",
		});
	});

	it("parses and canonicalizes marketplace OAuth client policy flags", () => {
		expect(
			parseMcpInstallArgs([
				"slack",
				"--transport=http",
				"--oauth-client-id",
				"  public-client  ",
				"--oauth-allowed-scope=search:read.public",
				"--oauth-allowed-scope",
				"channels:history",
				"--oauth-loopback-hostname=localhost",
				"https://mcp.slack.com/mcp",
			]),
		).toEqual({
			name: "slack",
			transport: "http",
			targetArgs: ["https://mcp.slack.com/mcp"],
			headers: [],
			oauthClientId: "public-client",
			oauthAllowedScopes: ["channels:history", "search:read.public"],
			oauthLoopbackHostname: "localhost",
		});
	});

	it("persists only the normalized public OAuth client policy", () => {
		const settingsPath = join(root, "cline_mcp_settings.json");
		const result = installMcpServer({
			name: "slack",
			transport: "http",
			targetArgs: ["https://mcp.slack.com/mcp"],
			oauthClientId: " public-client ",
			oauthAllowedScopes: ["search:read.public", "channels:history"],
			oauthLoopbackHostname: "127.0.0.1",
			settingsPath,
		});

		expect(result).toEqual({
			name: "slack",
			status: "installed",
			transport: {
				type: "streamableHttp",
				url: "https://mcp.slack.com/mcp",
			},
			oauthClient: {
				clientId: "public-client",
				allowedScopes: ["channels:history", "search:read.public"],
				loopbackHostname: "127.0.0.1",
			},
			warnings: [],
		});
		expect(readSettings(settingsPath).mcpServers?.slack).toEqual({
			transport: result.transport,
			oauthClient: result.oauthClient,
		});
	});

	it("requires a client ID for OAuth scope and loopback policy", () => {
		expect(() =>
			parseMcpInstallArgs([
				"slack",
				"--oauth-allowed-scope",
				"channels:history",
				"--transport=http",
				"https://mcp.slack.com/mcp",
			]),
		).toThrow(/--oauth-client-id is required/);
		expect(() =>
			parseMcpInstallArgs([
				"slack",
				"--oauth-loopback-hostname=localhost",
				"--transport=http",
				"https://mcp.slack.com/mcp",
			]),
		).toThrow(/--oauth-client-id is required/);
	});

	it("uses the Core OAuth scope policy for invalid and duplicate scopes", () => {
		expect(() =>
			parseMcpInstallArgs([
				"slack",
				"--oauth-client-id=public-client",
				"--oauth-allowed-scope=channels:history chat:write",
				"--transport=http",
				"https://mcp.slack.com/mcp",
			]),
		).toThrow(/Invalid MCP OAuth scope token/);
		expect(() =>
			parseMcpInstallArgs([
				"slack",
				"--oauth-client-id=public-client",
				"--oauth-allowed-scope=channels:history",
				"--oauth-allowed-scope",
				"channels:history",
				"--transport=http",
				"https://mcp.slack.com/mcp",
			]),
		).toThrow(/Duplicate MCP OAuth scope/);
	});

	it("rejects unsupported loopback hostnames and OAuth policy on stdio", () => {
		expect(() =>
			buildMcpInstallTransport({
				name: "slack",
				transport: "http",
				targetArgs: ["https://mcp.slack.com/mcp"],
				oauthClientId: "public-client",
				oauthLoopbackHostname: "example.com" as "localhost",
			}),
		).toThrow(/Expected 127\.0\.0\.1 or localhost/);
		expect(() =>
			buildMcpInstallTransport({
				name: "local",
				targetArgs: ["node", "server.js"],
				oauthClientId: "public-client",
			}),
		).toThrow(/Stdio MCP installs do not support OAuth client policy/);
	});

	it("rejects static Authorization headers with OAuth client policy", () => {
		expect(() =>
			buildMcpInstallTransport({
				name: "slack",
				transport: "http",
				targetArgs: ["https://mcp.slack.com/mcp"],
				headers: ["authorization: Bearer static-token"],
				oauthClientId: "public-client",
			}),
		).toThrow(/static Authorization header/);
	});

	it("fails closed on malformed, duplicate, and unsupported OAuth flags", () => {
		for (const args of [
			["slack", "--oauth-client-id"],
			["slack", "--oauth-client-id="],
			["slack", "--oauth-allowed-scope="],
			["slack", "--oauth-loopback-hostname", "--transport=http"],
		]) {
			expect(() => parseMcpInstallArgs(args)).toThrow(/requires a value/);
		}

		expect(() =>
			parseMcpInstallArgs([
				"slack",
				"--oauth-client-id=one",
				"--oauth-client-id",
				"two",
			]),
		).toThrow(/--oauth-client-id may only be specified once/);
		expect(() =>
			parseMcpInstallArgs([
				"slack",
				"--oauth-client-id=one",
				"--oauth-loopback-hostname=localhost",
				"--oauth-loopback-hostname",
				"127.0.0.1",
			]),
		).toThrow(/--oauth-loopback-hostname may only be specified once/);
		expect(() =>
			parseMcpInstallArgs(["slack", "--oauth-client-secret=not-supported"]),
		).toThrow(/Unsupported MCP OAuth install option/);
		expect(() =>
			parseMcpInstallArgs(["slack", "--oauth-client-identifier=one"]),
		).toThrow(/Unsupported MCP OAuth install option/);
	});

	it("treats -- in marketplace args as the end of option parsing", () => {
		// Marketplace catalog entries mark the start of the stdio command with
		// "--" (matching the CLI form `cline mcp install name -- npx ...`).
		// The separator must not become the command itself.
		const parsed = parseMcpInstallArgs([
			"aikido",
			"--",
			"npx",
			"-y",
			"@aikidosec/mcp@1.0.9",
		]);
		expect(parsed.targetArgs).toEqual(["npx", "-y", "@aikidosec/mcp@1.0.9"]);
		expect(buildMcpInstallTransport(parsed).transport).toEqual({
			type: "stdio",
			command: "npx",
			args: ["-y", "@aikidosec/mcp@1.0.9"],
		});
	});

	it("does not interpret OAuth-like command arguments after --", () => {
		const parsed = parseMcpInstallArgs([
			"local",
			"--",
			"node",
			"server.js",
			"--oauth-client-secret=command-argument",
			"--header",
			"X-Command: argument",
		]);
		expect(parsed).toEqual({
			name: "local",
			headers: [],
			targetArgs: [
				"node",
				"server.js",
				"--oauth-client-secret=command-argument",
				"--header",
				"X-Command: argument",
			],
			transport: undefined,
		});
		expect(buildMcpInstallTransport(parsed).transport).toEqual({
			type: "stdio",
			command: "node",
			args: [
				"server.js",
				"--oauth-client-secret=command-argument",
				"--header",
				"X-Command: argument",
			],
		});
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

describe("MCP uninstall service", () => {
	let root = "";

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "core-mcp-uninstall-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function writeSettings(settings: unknown): string {
		const settingsPath = join(root, "cline_mcp_settings.json");
		writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
		return settingsPath;
	}

	function seededSettings(): Record<string, unknown> {
		return {
			mcpServers: {
				docs: {
					transport: {
						type: "streamableHttp",
						url: "https://example.com/mcp",
						headers: { Authorization: "Bearer token" },
					},
				},
				keep: {
					transport: { type: "stdio", command: "node", args: ["server.js"] },
					disabled: true,
					autoApprove: ["read_file"],
				},
			},
			customTopLevelKey: { nested: true },
		};
	}

	it("removes only the requested server and preserves everything else", () => {
		const settingsPath = writeSettings(seededSettings());

		expect(uninstallMcpServer({ name: "docs", settingsPath })).toEqual({
			name: "docs",
			status: "uninstalled",
		});

		const written = readSettings(settingsPath);
		expect(Object.keys(written.mcpServers ?? {})).toEqual(["keep"]);
		expect(written.mcpServers?.keep).toEqual({
			transport: { type: "stdio", command: "node", args: ["server.js"] },
			disabled: true,
			autoApprove: ["read_file"],
		});
		expect(written.customTopLevelKey).toEqual({ nested: true });
	});

	it("trims the requested server name", () => {
		const settingsPath = writeSettings(seededSettings());

		expect(uninstallMcpServer({ name: "  docs  ", settingsPath })).toEqual({
			name: "docs",
			status: "uninstalled",
		});
		expect(Object.keys(readSettings(settingsPath).mcpServers ?? {})).toEqual([
			"keep",
		]);
	});

	it("keeps an empty mcpServers map after removing the last server", () => {
		const settingsPath = writeSettings({
			mcpServers: { docs: { transport: { type: "stdio", command: "node" } } },
		});

		uninstallMcpServer({ name: "docs", settingsPath });

		expect(readSettings(settingsPath).mcpServers).toEqual({});
	});

	it("rejects an unknown server without rewriting the settings file", () => {
		const settingsPath = writeSettings(seededSettings());
		const before = readFileSync(settingsPath, "utf8");

		expect(() => uninstallMcpServer({ name: "missing", settingsPath })).toThrow(
			'MCP server "missing" is not installed.',
		);
		expect(readFileSync(settingsPath, "utf8")).toBe(before);
	});

	it("rejects uninstalling from settings without an mcpServers map", () => {
		const settingsPath = writeSettings({ customTopLevelKey: true });
		const before = readFileSync(settingsPath, "utf8");

		expect(() => uninstallMcpServer({ name: "docs", settingsPath })).toThrow(
			/is not installed/,
		);
		expect(readFileSync(settingsPath, "utf8")).toBe(before);
	});

	it("does not create a settings file for an unknown server", () => {
		const settingsPath = join(root, "nested", "settings.json");

		expect(() => uninstallMcpServer({ name: "docs", settingsPath })).toThrow(
			/is not installed/,
		);
		expect(existsSync(settingsPath)).toBe(false);
	});

	it("rejects a blank name before touching settings", () => {
		const settingsPath = join(root, "nested", "settings.json");

		expect(() => uninstallMcpServer({ name: "   ", settingsPath })).toThrow(
			/MCP server name is required/,
		);
		expect(existsSync(settingsPath)).toBe(false);
	});

	it("round-trips an install followed by an uninstall", () => {
		const settingsPath = join(root, "cline_mcp_settings.json");
		installMcpServer({
			name: "fs",
			targetArgs: ["node", "server.js"],
			settingsPath,
		});

		uninstallMcpServer({ name: "fs", settingsPath });

		expect(readSettings(settingsPath).mcpServers).toEqual({});
	});
});
