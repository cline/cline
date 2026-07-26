import { describe, expect, it, vi } from "vitest";
import { createContributionRegistry } from "./contribution-registry";

describe("ContributionRegistry contributions", () => {
	it("accepts skills-only plugins without setup contributions", async () => {
		const registry = createContributionRegistry({
			extensions: [
				{
					name: "skill-pack",
					manifest: { capabilities: ["skills"] },
				},
			],
		});

		await expect(registry.initialize()).resolves.toBeUndefined();
		expect(registry.getRegistrySnapshot()).toMatchObject({
			tools: [],
			commands: [],
			rules: [],
			messageBuilder: [],
			providers: [],
			mcpServers: [],
		});
	});

	it("passes caller identity and logger context into setup", async () => {
		const logger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const registry = createContributionRegistry({
			setupContext: {
				session: { sessionId: "sess-1" },
				client: { name: "bedrock-coder-sdk", version: "1.0.0" },
				workspaceInfo: { rootPath: "/tmp/workspace" },
				logger,
			},
			extensions: [
				{
					name: "context-plugin",
					manifest: { capabilities: ["tools"] },
					setup(_api, ctx) {
						ctx.logger?.log("plugin setup", {
							sessionId: ctx.session?.sessionId,
							client: ctx.client?.name,
						});
					},
				},
			],
		});

		await registry.initialize();

		expect(logger.log).toHaveBeenCalledWith("plugin setup", {
			sessionId: "sess-1",
			client: "bedrock-coder-sdk",
		});
	});

	it("registers MCP servers declared by plugins", async () => {
		const registry = createContributionRegistry({
			extensions: [
				{
					name: "github-pack",
					manifest: { capabilities: ["mcp"] },
					setup(api) {
						api.registerMcpServer({
							name: "github",
							transport: {
								type: "stdio",
								command: "npx",
								args: ["-y", "@modelcontextprotocol/server-github"],
							},
						});
					},
				},
			],
		});

		await registry.initialize();

		expect(registry.getRegisteredMcpServers()).toEqual([
			expect.objectContaining({
				name: "github",
				metadata: {
					source: "plugin",
					plugin: "github-pack",
				},
			}),
		]);
	});
});
