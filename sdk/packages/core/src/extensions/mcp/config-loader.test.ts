import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	hasMcpSettingsFile,
	loadMcpSettingsFile,
	registerMcpServersFromSettingsFile,
	resolveMcpServerRegistrations,
} from "./config-loader";

describe("mcp config loader", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
		tempRoots.length = 0;
	});

	it("loads and validates mcp server registrations from JSON", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						docs: {
							transport: {
								type: "stdio",
								command: "npx",
								args: ["-y", "@modelcontextprotocol/server-filesystem"],
							},
						},
						search: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.example.com",
							},
							disabled: true,
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		expect(hasMcpSettingsFile({ filePath })).toBe(true);
		expect(
			loadMcpSettingsFile({ filePath }).mcpServers.docs.transport.type,
		).toBe("stdio");

		const registrations = resolveMcpServerRegistrations({ filePath });
		expect(registrations).toEqual([
			{
				name: "docs",
				transport: {
					type: "stdio",
					command: "npx",
					args: ["-y", "@modelcontextprotocol/server-filesystem"],
				},
				disabled: undefined,
				metadata: undefined,
			},
			{
				name: "search",
				transport: {
					type: "streamableHttp",
					url: "https://mcp.example.com",
				},
				disabled: true,
				metadata: undefined,
			},
		]);
	});

	it("registers loaded servers with an mcp manager", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						docs: {
							transport: {
								type: "stdio",
								command: "node",
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const registered: Array<{ name: string }> = [];
		const manager = {
			registerServer: async (registration: { name: string }) => {
				registered.push(registration);
			},
		};

		await registerMcpServersFromSettingsFile(manager, { filePath });
		expect(registered).toEqual([
			{
				name: "docs",
				transport: {
					type: "stdio",
					command: "node",
				},
				disabled: undefined,
				metadata: undefined,
			},
		]);
	});

	it("throws a clear error for invalid config", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						broken: {
							transport: {
								type: "stdio",
								command: "",
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		expect(() => resolveMcpServerRegistrations({ filePath })).toThrow(
			"Invalid MCP settings",
		);
	});

	it("accepts legacy flat stdio format", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						docs: {
							command: "node",
							args: ["server.js"],
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const registrations = resolveMcpServerRegistrations({ filePath });
		expect(registrations).toEqual([
			{
				name: "docs",
				transport: {
					type: "stdio",
					command: "node",
					args: ["server.js"],
				},
				disabled: undefined,
				metadata: undefined,
			},
		]);
	});

	it("accepts legacy flat url format and preserves explicit transportType", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						legacySse: {
							url: "https://sse.example.com",
						},
						legacyHttp: {
							url: "https://http.example.com",
							transportType: "http",
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const registrations = resolveMcpServerRegistrations({ filePath });
		expect(registrations).toEqual([
			{
				name: "legacySse",
				transport: {
					type: "sse",
					url: "https://sse.example.com",
				},
				disabled: undefined,
				metadata: undefined,
			},
			{
				name: "legacyHttp",
				transport: {
					type: "streamableHttp",
					url: "https://http.example.com",
				},
				disabled: undefined,
				metadata: undefined,
			},
		]);
	});
});
