import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDirs } from "../test-support/temp-dirs";
import {
	clineConnectionLoaders,
	parseChannels,
	parseComposio,
	readClineConnections,
} from "./cline-connections";
import { githubRoutes } from "./github/github";
import { COMPOSIO_READ_UNAVAILABLE } from "./pinned/composio";

const tempDir = useTempDirs("next-turn-connectors-");

describe("the person's Cline connections", () => {
	test("the Composio state is read through the resolver the host's core exports, under either of its names", async () => {
		const statePath = join(tempDir(), "composio.json");
		const state = { toolkits: { linear: { connectedAccountId: "ca_1" } } };
		writeFileSync(statePath, JSON.stringify(state));
		const hostCore = (resolvers: Record<string, () => string>) => async () =>
			({
				ProviderSettingsManager: class {
					getProviderSettings() {
						return { auth: { accountId: "acct_1" } };
					}
				},
				...resolvers,
			}) as never;
		for (const name of [
			"resolveComposioConnectionStatePath",
			"resolveComposioToolsStatePath",
		]) {
			const loaders = clineConnectionLoaders(
				undefined,
				hostCore({ [name]: () => statePath }),
			);
			expect(await loaders.composio()).toEqual(state);
		}
		expect(
			await clineConnectionLoaders(undefined, hostCore({})).composio(),
		).toBeUndefined();
	});

	test("Composio toolkits, MCP servers and channels: names and states only", async () => {
		const connections = await readClineConnections({
			composio: async () => ({
				toolkits: {
					GitHub: { connectedAccountId: "ca_1" },
					linear: {},
				},
			}),
			mcp: async () => ({
				mcpServers: {
					github: {
						transport: {
							type: "stdio",
							command: "docker",
							args: ["run", "ghcr.io/github/github-mcp-server"],
							env: { GITHUB_TOKEN: "SECRET" },
						},
					},
					sentry: {
						transport: {
							type: "streamableHttp",
							url: "https://mcp.sentry.dev/mcp",
							headers: { Authorization: "SECRET" },
						},
						disabled: true,
					},
				},
			}),
			channels: async () => {
				throw new Error("no hub");
			},
		});
		expect(connections.composio).toEqual([
			{ toolkit: "github", connected: true },
			{ toolkit: "linear", connected: false },
		]);
		expect(
			connections.mcp.map((server) => [
				server.name,
				server.target,
				server.disabled,
			]),
		).toEqual([
			["github", "docker run ghcr.io/github/github-mcp-server", false],
			["sentry", "mcp.sentry.dev/mcp", true],
		]);
		expect(connections.channels).toEqual([]);
		expect(JSON.stringify(connections)).not.toContain("SECRET");
		expect(
			parseChannels({
				configured: [
					{ id: "a", type: "slack" },
					{ id: "b", type: "slack" },
					{ id: "c", type: "telegram" },
				],
			}),
		).toEqual(["slack", "telegram"]);
		expect(parseComposio(null)).toEqual([]);
	});

	test("GitHub's routes: gh reads; Composio and MCP mention, each saying why it cannot read yet", () => {
		const routes = githubRoutes(true, {
			composio: [{ toolkit: "github", connected: true }],
			mcp: [
				{
					name: "gh-server",
					transport: "stdio",
					disabled: false,
					target: "github-mcp-server",
				},
			],
			channels: [],
		});
		expect(routes.map((route) => [route.id, route.read === true])).toEqual([
			["gh", true],
			["composio", false],
			["mcp:gh-server", false],
		]);
		expect(routes[1]?.read).toEqual({ reason: COMPOSIO_READ_UNAVAILABLE });
	});
});
