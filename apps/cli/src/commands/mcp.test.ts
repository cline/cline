import { describe, expect, it, vi } from "vitest";
import {
	buildMcpInstallDefaults,
	buildMcpInstallTransport,
	runMcpInstallCommand,
} from "./mcp";
import { addServer } from "../wizards/mcp/settings";

vi.mock("../wizards/mcp/settings", () => ({
	addServer: vi.fn(),
}));

describe("mcp install command", () => {
	it("builds stdio wizard defaults from command args", () => {
		expect(
			buildMcpInstallDefaults({
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
			type: "stdio",
			command: 'npx -y @modelcontextprotocol/server-filesystem "/tmp/my dir"',
		});
	});

	it("builds remote wizard defaults and normalizes http transport", () => {
		expect(
			buildMcpInstallDefaults({
				name: "ctx7",
				transport: "http",
				targetArgs: ["https://mcp.context7.com/mcp"],
			}),
		).toEqual({
			name: "ctx7",
			type: "streamableHttp",
			url: "https://mcp.context7.com/mcp",
		});
	});

	it("normalizes streamable-http transport", () => {
		expect(
			buildMcpInstallDefaults({
				name: "docs",
				transport: "streamable-http",
				targetArgs: ["https://example.com/mcp"],
			}),
		).toEqual({
			name: "docs",
			type: "streamableHttp",
			url: "https://example.com/mcp",
		});
	});

	it("builds SSE wizard defaults", () => {
		expect(
			buildMcpInstallDefaults({
				name: "events",
				transport: "sse",
				targetArgs: ["https://example.com/sse"],
			}),
		).toEqual({
			name: "events",
			type: "sse",
			url: "https://example.com/sse",
		});
	});

	it("rejects missing stdio command and invalid remote URL", () => {
		expect(() =>
			buildMcpInstallDefaults({
				name: "fs",
			}),
		).toThrow(/requires a command/);

		expect(() =>
			buildMcpInstallDefaults({
				name: "bad",
				transport: "http",
				targetArgs: ["not-a-url"],
			}),
		).toThrow(/Invalid MCP server URL/);
	});

	it("rejects remote URL schemes other than http and https", () => {
		expect(() =>
			buildMcpInstallDefaults({
				name: "bad",
				transport: "http",
				targetArgs: ["file:///etc/passwd"],
			}),
		).toThrow(/only http and https are supported/);
	});

	it("builds direct stdio installs without shell-joining args", () => {
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

	it("builds direct remote installs with headers and placeholder warnings", () => {
		expect(
			buildMcpInstallTransport({
				name: "docs",
				transport: "http",
				headers: ["Authorization: Bearer <token>"],
				targetArgs: ["https://example.com/mcp", "--header=X-Extra: yes"],
			}),
		).toEqual({
			name: "docs",
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
	});

	it("opens the add wizard with prefilled defaults", async () => {
		const runWizard = vi.fn(async () => 0);

		const code = await runMcpInstallCommand({
			name: "ctx7",
			transport: "http",
			targetArgs: ["https://mcp.context7.com/mcp"],
			isTty: true,
			runWizard,
			io: { writeErr: vi.fn() },
		});

		expect(code).toBe(0);
		expect(runWizard).toHaveBeenCalledWith({
			name: "ctx7",
			type: "streamableHttp",
			url: "https://mcp.context7.com/mcp",
		});
	});

	it("requires a TTY because it opens the wizard", async () => {
		const writeErr = vi.fn();
		const runWizard = vi.fn(async () => 0);

		const code = await runMcpInstallCommand({
			name: "ctx7",
			transport: "http",
			targetArgs: ["https://mcp.context7.com/mcp"],
			isTty: false,
			runWizard,
			io: { writeErr },
		});

		expect(code).toBe(1);
		expect(runWizard).not.toHaveBeenCalled();
		expect(writeErr).toHaveBeenCalledWith(
			"cline mcp install opens the MCP wizard and requires a TTY. Pass --yes to install noninteractively.",
		);
	});

	it("checks for TTY before validating wizard install arguments", async () => {
		const writeErr = vi.fn();

		const code = await runMcpInstallCommand({
			name: "fs",
			isTty: false,
			io: { writeErr },
		});

		expect(code).toBe(1);
		expect(writeErr).toHaveBeenCalledWith(
			"cline mcp install opens the MCP wizard and requires a TTY. Pass --yes to install noninteractively.",
		);
	});

	it("installs directly with --yes without requiring a TTY", async () => {
		const writeln = vi.fn();
		const writeErr = vi.fn();

		const code = await runMcpInstallCommand({
			name: "docs",
			transport: "http",
			targetArgs: [
				"https://example.com/mcp",
				"--header",
				"Authorization: Bearer token",
			],
			isTty: false,
			yes: true,
			io: { writeln, writeErr },
		});

		expect(code).toBe(0);
		expect(addServer).toHaveBeenCalledWith("docs", {
			type: "streamableHttp",
			url: "https://example.com/mcp",
			headers: {
				Authorization: "Bearer token",
			},
		});
		expect(writeln).toHaveBeenCalledWith("Installed MCP server docs.");
		expect(writeErr).not.toHaveBeenCalled();
	});

	it("prints direct install JSON with --yes --json", async () => {
		const writeln = vi.fn();

		const code = await runMcpInstallCommand({
			name: "fs",
			targetArgs: ["node", "server.js"],
			isTty: false,
			yes: true,
			json: true,
			io: { writeln, writeErr: vi.fn() },
		});

		expect(code).toBe(0);
		expect(JSON.parse(writeln.mock.calls[0]?.[0])).toMatchObject({
			name: "fs",
			status: "installed",
			transport: {
				type: "stdio",
				command: "node",
				args: ["server.js"],
			},
		});
	});
});
