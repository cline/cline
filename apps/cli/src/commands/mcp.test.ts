import { describe, expect, it, vi } from "vitest";
import { buildMcpInstallDefaults, runMcpInstallCommand } from "./mcp";

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
			"cline mcp install opens the MCP wizard and requires a TTY.",
		);
	});
});
