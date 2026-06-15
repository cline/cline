import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	disablePluginMcpServersInSettings,
	removePluginMcpServersFromSettings,
	syncPluginMcpServersToSettings,
} from "./plugin-mcp-settings";

describe("plugin MCP settings sync", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
		tempRoots.length = 0;
	});

	async function createPlugin(source: string): Promise<{
		root: string;
		pluginPath: string;
		settingsPath: string;
	}> {
		const root = await mkdtemp(join(tmpdir(), "core-plugin-mcp-settings-"));
		tempRoots.push(root);
		const pluginPath = join(root, "plugin.mjs");
		const settingsPath = join(root, "cline_mcp_settings.json");
		await writeFile(pluginPath, source, "utf8");
		return { root, pluginPath, settingsPath };
	}

	it("writes plugin MCP servers into mcp settings", async () => {
		const { pluginPath, settingsPath } = await createPlugin(`
export default {
  name: "repo-docs",
  manifest: { capabilities: ["mcp"] },
  setup(api) {
    api.registerMcpServer({
      name: "repo-docs",
      transport: { type: "streamableHttp", url: "https://example.com/mcp" },
    })
  },
}
`);

		const result = await syncPluginMcpServersToSettings({
			pluginPaths: [pluginPath],
			settingsPath,
		});

		expect(result.mutations).toEqual([
			expect.objectContaining({
				name: "repo-docs",
				pluginName: "repo-docs",
				pluginPath,
				action: "created",
			}),
		]);
		const written = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: Record<
				string,
				{ metadata?: Record<string, unknown>; transport?: unknown }
			>;
		};
		expect(written.mcpServers?.["repo-docs"]?.metadata).toMatchObject({
			source: "plugin",
			pluginName: "repo-docs",
			pluginPath,
		});
	});

	it("defaults plugin stdio MCP cwd to the plugin directory", async () => {
		const { pluginPath, settingsPath } = await createPlugin(`
export default {
  name: "repo-docs",
  manifest: { capabilities: ["mcp"] },
  setup(api) {
    api.registerMcpServer({
      name: "repo-docs",
      transport: { type: "stdio", command: "node", args: ["./server.js"] },
    })
  },
}
`);

		await syncPluginMcpServersToSettings({
			pluginPaths: [pluginPath],
			settingsPath,
		});

		const written = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: Record<string, { transport?: { cwd?: string } }>;
		};
		expect(written.mcpServers?.["repo-docs"]?.transport?.cwd).toBe(
			dirname(pluginPath),
		);
	});

	it("preserves explicit plugin stdio MCP cwd", async () => {
		const { pluginPath, settingsPath } = await createPlugin(`
export default {
  name: "repo-docs",
  manifest: { capabilities: ["mcp"] },
  setup(api) {
    api.registerMcpServer({
      name: "repo-docs",
      transport: { type: "stdio", command: "node", args: ["./server.js"], cwd: "/tmp/custom-cwd" },
    })
  },
}
`);

		await syncPluginMcpServersToSettings({
			pluginPaths: [pluginPath],
			settingsPath,
		});

		const written = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: Record<string, { transport?: { cwd?: string } }>;
		};
		expect(written.mcpServers?.["repo-docs"]?.transport?.cwd).toBe(
			"/tmp/custom-cwd",
		);
	});

	it("does not create settings for plugins without MCP servers", async () => {
		const { pluginPath, settingsPath } = await createPlugin(`
export default {
  name: "plain-tools",
  manifest: { capabilities: ["tools"] },
  setup(api) {
    api.registerTool({
      name: "plain",
      inputSchema: {},
      execute: async () => "ok",
    })
  },
}
`);

		const result = await syncPluginMcpServersToSettings({
			pluginPaths: [pluginPath],
			settingsPath,
		});

		expect(result).toEqual({
			mutations: [],
			failures: [],
		});
		await expect(readFile(settingsPath, "utf8")).rejects.toThrow();
	});

	it("removes stale owned servers when a plugin stops declaring MCP", async () => {
		const { pluginPath, settingsPath } = await createPlugin(`
export default {
  name: "plain-tools",
  manifest: { capabilities: ["tools"] },
  setup(api) {
    api.registerTool({
      name: "plain",
      inputSchema: {},
      execute: async () => "ok",
    })
  },
}
`);
		await writeFile(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						"old-docs": {
							transport: {
								type: "streamableHttp",
								url: "https://old.example.com/mcp",
							},
							metadata: {
								source: "plugin",
								pluginName: "plain-tools",
								pluginPath,
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const result = await syncPluginMcpServersToSettings({
			pluginPaths: [pluginPath],
			settingsPath,
		});

		expect(result.mutations).toEqual([
			expect.objectContaining({
				name: "old-docs",
				pluginName: "plain-tools",
				pluginPath,
				action: "removed",
			}),
		]);
		const written = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: Record<string, unknown>;
		};
		expect(written.mcpServers?.["old-docs"]).toBeUndefined();
	});

	it("removes stale owned servers when a plugin no longer has setup", async () => {
		const { pluginPath, settingsPath } = await createPlugin(`
export default {
  name: "repo-docs",
  manifest: { capabilities: ["mcp"] },
}
`);
		await writeFile(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						"old-docs": {
							transport: {
								type: "streamableHttp",
								url: "https://old.example.com/mcp",
							},
							metadata: {
								source: "plugin",
								pluginName: "repo-docs",
								pluginPath,
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const result = await syncPluginMcpServersToSettings({
			pluginPaths: [pluginPath],
			settingsPath,
		});

		expect(result.mutations).toEqual([
			expect.objectContaining({
				name: "old-docs",
				pluginName: "repo-docs",
				pluginPath,
				action: "removed",
			}),
		]);
		const written = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: Record<string, unknown>;
		};
		expect(written.mcpServers?.["old-docs"]).toBeUndefined();
	});

	it("isolates plugin setup failures while syncing other plugins", async () => {
		const { root, settingsPath } = await createPlugin("export default {};\n");
		const goodPluginPath = join(root, "good-plugin.mjs");
		const badPluginPath = join(root, "bad-plugin.mjs");
		await writeFile(
			goodPluginPath,
			`
export default {
  name: "good-plugin",
  manifest: { capabilities: ["mcp"] },
  setup(api) {
    api.registerMcpServer({
      name: "good-docs",
      transport: { type: "streamableHttp", url: "https://good.example.com/mcp" },
    })
  },
}
`,
			"utf8",
		);
		await writeFile(
			badPluginPath,
			`
export default {
  name: "bad-plugin",
  manifest: { capabilities: ["tools"] },
  setup(api) {
    api.registerMcpServer({
      name: "bad-docs",
      transport: { type: "streamableHttp", url: "https://bad.example.com/mcp" },
    })
  },
}
`,
			"utf8",
		);
		await writeFile(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						"bad-docs": {
							transport: {
								type: "streamableHttp",
								url: "https://old-bad.example.com/mcp",
							},
							metadata: {
								source: "plugin",
								pluginName: "bad-plugin",
								pluginPath: badPluginPath,
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const result = await syncPluginMcpServersToSettings({
			pluginPaths: [goodPluginPath, badPluginPath],
			settingsPath,
		});

		expect(result.failures).toEqual([
			expect.objectContaining({
				pluginPath: badPluginPath,
				pluginName: "bad-plugin",
				message: 'registerMcpServer requires the "mcp" capability',
			}),
		]);
		expect(result.mutations).toEqual([
			expect.objectContaining({
				name: "good-docs",
				pluginName: "good-plugin",
				pluginPath: goodPluginPath,
				action: "created",
			}),
		]);
		const written = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: Record<string, { transport?: { url?: string } }>;
		};
		expect(written.mcpServers?.["good-docs"]?.transport?.url).toBe(
			"https://good.example.com/mcp",
		);
		expect(written.mcpServers?.["bad-docs"]?.transport?.url).toBe(
			"https://old-bad.example.com/mcp",
		);
	});

	it("skips user-owned name collisions", async () => {
		const { pluginPath, settingsPath } = await createPlugin(`
export default {
  name: "repo-docs",
  manifest: { capabilities: ["mcp"] },
  setup(api) {
    api.registerMcpServer({
      name: "repo-docs",
      transport: { type: "streamableHttp", url: "https://plugin.example.com/mcp" },
    })
  },
}
`);
		await writeFile(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						"repo-docs": {
							transport: {
								type: "streamableHttp",
								url: "https://user.example.com/mcp",
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const result = await syncPluginMcpServersToSettings({
			pluginPaths: [pluginPath],
			settingsPath,
		});

		expect(result.mutations[0]).toMatchObject({
			name: "repo-docs",
			action: "skipped",
		});
		const written = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: Record<string, { transport?: { url?: string } }>;
		};
		expect(written.mcpServers?.["repo-docs"]?.transport?.url).toBe(
			"https://user.example.com/mcp",
		);
	});

	it("does not overwrite invalid MCP settings", async () => {
		const { pluginPath, settingsPath } = await createPlugin(`
export default {
  name: "repo-docs",
  manifest: { capabilities: ["mcp"] },
  setup(api) {
    api.registerMcpServer({
      name: "repo-docs",
      transport: { type: "streamableHttp", url: "https://example.com/mcp" },
    })
  },
}
`);
		await writeFile(settingsPath, "{ nope", "utf8");

		const result = await syncPluginMcpServersToSettings({
			pluginPaths: [pluginPath],
			settingsPath,
		});

		expect(result.failures[0]).toEqual(
			expect.objectContaining({
				pluginPath,
			}),
		);
		expect(await readFile(settingsPath, "utf8")).toBe("{ nope");
	});

	it("preserves oauth when updating plugin-owned entries", async () => {
		const { pluginPath, settingsPath } = await createPlugin(`
export default {
  name: "repo-docs",
  manifest: { capabilities: ["mcp"] },
  setup(api) {
    api.registerMcpServer({
      name: "repo-docs",
      transport: { type: "streamableHttp", url: "https://new.example.com/mcp" },
    })
  },
}
`);
		await writeFile(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						"repo-docs": {
							transport: {
								type: "streamableHttp",
								url: "https://old.example.com/mcp",
							},
							oauth: {
								tokens: {
									access_token: "token",
								},
							},
							metadata: {
								source: "plugin",
								pluginName: "repo-docs",
								pluginPath,
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		await syncPluginMcpServersToSettings({
			pluginPaths: [pluginPath],
			settingsPath,
		});

		const written = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: Record<
				string,
				{
					transport?: { url?: string };
					oauth?: { tokens?: Record<string, string> };
				}
			>;
		};
		expect(written.mcpServers?.["repo-docs"]?.transport?.url).toBe(
			"https://new.example.com/mcp",
		);
		expect(written.mcpServers?.["repo-docs"]?.oauth?.tokens?.access_token).toBe(
			"token",
		);
	});

	it("disables and removes plugin-owned entries", async () => {
		const { pluginPath, settingsPath } = await createPlugin(`
export default {
  name: "repo-docs",
  manifest: { capabilities: ["mcp"] },
  setup(api) {
    api.registerMcpServer({
      name: "repo-docs",
      transport: { type: "streamableHttp", url: "https://example.com/mcp" },
    })
  },
}
`);
		await syncPluginMcpServersToSettings({
			pluginPaths: [pluginPath],
			settingsPath,
		});

		disablePluginMcpServersInSettings({
			pluginPaths: [pluginPath],
			settingsPath,
		});
		let written = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: Record<string, { disabled?: boolean } | undefined>;
		};
		expect(written.mcpServers?.["repo-docs"]?.disabled).toBe(true);

		removePluginMcpServersFromSettings({
			pluginPaths: [pluginPath],
			settingsPath,
		});
		written = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: Record<string, { disabled?: boolean } | undefined>;
		};
		expect(written.mcpServers?.["repo-docs"]).toBeUndefined();
	});
});
