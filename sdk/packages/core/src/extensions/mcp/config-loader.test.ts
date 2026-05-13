import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	hasMcpSettingsFile,
	listMcpServerOAuthStatuses,
	loadMcpSettingsFile,
	registerMcpServersFromSettingsFile,
	resolveMcpServerRegistrations,
	setMcpServerDisabled,
	updateMcpServerOAuthState,
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
				oauth: undefined,
			},
			{
				name: "search",
				transport: {
					type: "streamableHttp",
					url: "https://mcp.example.com",
				},
				disabled: true,
				metadata: undefined,
				oauth: undefined,
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
				oauth: undefined,
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
				oauth: undefined,
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
				oauth: undefined,
			},
			{
				name: "legacyHttp",
				transport: {
					type: "streamableHttp",
					url: "https://http.example.com",
				},
				disabled: undefined,
				metadata: undefined,
				oauth: undefined,
			},
		]);
	});

	it("updates disabled state while preserving legacy server shape and top-level settings", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					otherSetting: true,
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

		setMcpServerDisabled({ filePath, name: "docs", disabled: true });
		const disabled = JSON.parse(await readFile(filePath, "utf8")) as {
			otherSetting?: boolean;
			mcpServers?: Record<
				string,
				{ command?: string; args?: string[]; disabled?: boolean }
			>;
		};
		expect(disabled.otherSetting).toBe(true);
		expect(disabled.mcpServers?.docs).toEqual({
			command: "node",
			args: ["server.js"],
			disabled: true,
		});

		setMcpServerDisabled({ filePath, name: "docs", disabled: false });
		const enabled = JSON.parse(await readFile(filePath, "utf8")) as {
			mcpServers?: Record<string, { disabled?: boolean }>;
		};
		expect(enabled.mcpServers?.docs?.disabled).toBeUndefined();
	});

	it("loads and updates sdk-managed oauth state in server entries", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						linear: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.linear.app/mcp",
							},
							oauth: {
								tokens: {
									access_token: "old-token",
									token_type: "Bearer",
								},
								lastAuthenticatedAt: 123,
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const registrations = resolveMcpServerRegistrations({ filePath });
		expect(registrations[0]?.oauth?.tokens?.access_token).toBe("old-token");
		expect(listMcpServerOAuthStatuses({ filePath })).toEqual([
			{
				serverName: "linear",
				oauthSupported: true,
				oauthConfigured: true,
				lastError: undefined,
				lastAuthenticatedAt: 123,
			},
		]);

		updateMcpServerOAuthState(
			"linear",
			(current) => ({
				...current,
				tokens: {
					access_token: "new-token",
					token_type: "Bearer",
				},
				lastError: undefined,
			}),
			{ filePath },
		);

		const written = JSON.parse(await readFile(filePath, "utf8")) as {
			mcpServers: {
				linear: {
					oauth?: {
						tokens?: Record<string, unknown>;
						lastAuthenticatedAt?: number;
					};
				};
			};
		};
		expect(written.mcpServers.linear.oauth?.tokens?.access_token).toBe(
			"new-token",
		);
		expect(written.mcpServers.linear.oauth?.lastAuthenticatedAt).toBe(123);
	});

	it("rejects inherited server names when updating oauth state", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {},
				},
				null,
				2,
			),
			"utf8",
		);

		const objectPrototype = Object.prototype as { oauth?: unknown };
		const originalOauth = objectPrototype.oauth;
		try {
			expect(() =>
				updateMcpServerOAuthState(
					"__proto__",
					() => ({
						tokens: {
							access_token: "bad-token",
						},
					}),
					{ filePath },
				),
			).toThrow("Unknown MCP server: __proto__");
			expect(objectPrototype.oauth).toBe(originalOauth);
		} finally {
			if (originalOauth === undefined) {
				delete objectPrototype.oauth;
			} else {
				objectPrototype.oauth = originalOauth;
			}
		}
	});
});
