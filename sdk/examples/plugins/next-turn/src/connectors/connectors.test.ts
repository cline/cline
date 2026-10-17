import { describe, expect, test } from "bun:test";
import type { McpServerRegistration } from "@cline/core";
import { defaultSettings, type Settings } from "../settings/settings";
import type { ConnectionLoaders } from "./cline-connections";
import { failure, fakeRun, repoEnv } from "./connectors.fixtures";
import { GhReader } from "./github/gh";
import { ghHandler, settingsWith } from "./github/github.fixtures";
import { Connectors } from "./index";
import { COMPOSIO_READ_UNAVAILABLE } from "./pinned/composio";
import type { McpRunnerDeps } from "./pinned/runners";

function connectorsWith(options: {
	settings: Settings;
	loaders: Partial<ConnectionLoaders>;
	gh?: GhReader;
	mcp?: McpRunnerDeps;
}): Connectors {
	return new Connectors({
		loaders: {
			composio: async () => undefined,
			mcp: async () => ({ mcpServers: {} }),
			channels: async () => undefined,
			...options.loaders,
		},
		gh: options.gh ?? new GhReader(fakeRun(ghHandler)),
		mcp: options.mcp ?? {
			registration: async () => undefined,
			client: async () => Promise.reject(new Error("unused")),
		},
		settings: () => options.settings,
		env: () => repoEnv,
	});
}

describe("Connected to Next Turn", () => {
	test("rows for GitHub, each Composio toolkit and each channel, with reasons on what is disabled", async () => {
		const settings = settingsWith("mention");
		const connectors = connectorsWith({
			settings,
			loaders: {
				composio: async () => ({
					toolkits: {
						github: { connectedAccountId: "ca" },
						linear: { connectedAccountId: "cb" },
						gmail: { connectedAccountId: "cc" },
					},
				}),
				channels: async () => ({ configured: [{ id: "c", type: "slack" }] }),
			},
		});
		await connectors.detect();
		expect(connectors.all().map((entry) => entry.id)).toEqual([
			"github",
			"composio:gmail",
			"composio:linear",
		]);
		expect(connectors.access("composio:linear").role).toBe("mention");
		expect(connectors.access("composio:gmail").role).toBe("off");
		const rows = connectors.rows();
		expect(rows.map((row) => [row.id, row.group, row.role])).toEqual([
			["github", "GitHub", "mention"],
			["composio:gmail", "Composio", "off"],
			["composio:linear", "Composio", "mention"],
			["menubar", "Chat channels", "notify"],
			["channel:slack", "Chat channels", "off"],
		]);
		expect(rows[0]?.scopes.map((scope) => scope.cadence)).toEqual([
			"on push · every 5 min",
			"every 5 min",
			"every 15 min",
		]);
		const github = rows[0];
		expect(github?.status).toBe(
			"gh, signed in (the sign-in Cline's PR bar uses) · Composio, through your Cline account",
		);
		expect(github?.roles.find((option) => option.role === "read")).toEqual({
			role: "read",
			enabled: true,
		});
		expect(
			github?.roles.find((option) => option.role === "notify")?.enabled,
		).toBe(false);
		expect(
			rows[2]?.roles.find((option) => option.role === "read")?.reason,
		).toBe(COMPOSIO_READ_UNAVAILABLE);
		expect(
			rows[4]?.roles.find((option) => option.role === "notify")?.reason,
		).toBe(
			"Needs-you notifications reach the menubar today; this channel cannot receive them yet",
		);
		settings.planner.model = {
			kind: "model",
			providerId: "openai",
			modelId: "fast",
		};
		expect(
			connectors.rows()[0]?.roles.find((option) => option.role === "read")
				?.reason,
		).toBe(
			"Facts go to the same model as your chat. Choosing another model for suggestions turns Read off.",
		);
	});

	test("MCP servers get rows; Read opens once a pin exists; the refresher runs pinned reads", async () => {
		const settings = defaultSettings();
		settings.connectors["mcp:linear"] = {
			role: "read",
			scopes: ["mine"],
			reads: [{ id: "mine", tool: "list_my_issues", arguments: {} }],
		};
		settings.connectors["composio:notion"] = { role: "mention", scopes: [] };
		const ran: string[] = [];
		const connectors = connectorsWith({
			settings,
			loaders: {
				composio: async () => ({
					toolkits: { notion: { connectedAccountId: "x" } },
				}),
				mcp: async () => ({
					mcpServers: {
						linear: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.linear.app/mcp",
							},
						},
						sentry: {
							transport: {
								type: "stdio",
								command: "npx",
								args: ["sentry-mcp"],
							},
						},
						off: { transport: { type: "stdio", command: "x" }, disabled: true },
					},
				}),
			},
			gh: new GhReader(
				fakeRun(() => {
					throw failure("ENOENT");
				}),
			),
			mcp: {
				registration: async (name) => ({
					name,
					transport: {
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
				}),
				client: async () => ({
					connect: async () => undefined,
					disconnect: async () => undefined,
					callTool: async ({ name }) => {
						ran.push(name);
						return { content: [{ type: "text", text: "[]" }] };
					},
				}),
			},
		});
		await connectors.detect();
		expect(connectors.all().map((connector) => connector.id)).toEqual([
			"github",
			"composio:notion",
			"mcp:linear",
			"mcp:sentry",
		]);
		const byId = Object.fromEntries(
			connectors.rows().map((row) => [row.id, row]),
		);
		expect(byId["mcp:linear"]?.status).toBe("In Cline's MCP settings · HTTP");
		expect(
			byId["mcp:linear"]?.roles.find((option) => option.role === "read"),
		).toEqual({ role: "read", enabled: true });
		expect(byId["mcp:linear"]?.scopes).toEqual([
			{
				id: "mine",
				label: "list_my_issues",
				everyMinutes: 15,
				checked: true,
				cadence: "every 15 min",
			},
		]);
		expect(byId["mcp:sentry"]?.status).toBe(
			"In Cline's MCP settings · stdio; each read starts the server",
		);
		expect(
			byId["mcp:sentry"]?.roles.find((option) => option.role === "read")
				?.reason,
		).toBe("Pin a read-only tool, with its arguments, to read through it");
		expect(byId["mcp:off"]?.detected).toBe(false);
		expect(
			byId["composio:notion"]?.roles.find((option) => option.role === "read")
				?.reason,
		).toBe(COMPOSIO_READ_UNAVAILABLE);
		await connectors.refresher.start();
		connectors.refresher.stop();
		expect(ran).toEqual(["list_my_issues"]);
	});

	test("after a turn, connections added or removed during the chat count, and a kept one keeps its facts", async () => {
		const settings = defaultSettings();
		settings.connectors["mcp:linear"] = {
			role: "read",
			scopes: ["mine"],
			reads: [{ id: "mine", tool: "list_my_issues", arguments: {} }],
		};
		const linear = {
			transport: {
				type: "streamableHttp" as const,
				url: "https://mcp.linear.app/mcp",
			},
		};
		let servers: Record<string, Omit<McpServerRegistration, "name">> = {
			linear,
			sentry: { transport: { type: "stdio", command: "npx" } },
		};
		let now = 0;
		let signedIn = false;
		const connectors = connectorsWith({
			settings,
			loaders: { mcp: async () => ({ mcpServers: servers }) },
			gh: new GhReader(
				fakeRun((call) => {
					if (!signedIn) throw failure(1);
					return ghHandler(call);
				}),
				() => now,
			),
			mcp: {
				registration: async (name) => ({ name, transport: linear.transport }),
				client: async () => ({
					connect: async () => undefined,
					disconnect: async () => undefined,
					callTool: async () => ({
						content: [{ type: "text", text: '["ENG-1"]' }],
					}),
				}),
			},
		});
		await connectors.detect();
		await connectors.refresher.start();
		connectors.refresher.stop();
		const linearFacts = () =>
			connectors
				.all()
				.find((connector) => connector.id === "mcp:linear")
				?.facts?.(repoEnv, 100);
		const read = linearFacts();
		expect(connectors.access("github").role).toBe("off");
		servers = {
			linear,
			notion: { transport: { type: "stdio", command: "x" } },
		};
		signedIn = true;
		now = 300_001;
		await connectors.onTurn({});
		expect(connectors.all().map((connector) => connector.id)).toEqual([
			"github",
			"mcp:linear",
			"mcp:notion",
		]);
		expect(connectors.access("github").role).toBe("mention");
		expect(connectors.access("mcp:sentry").role).toBe("off");
		expect(linearFacts()).toEqual(read);
		expect(JSON.stringify(read)).toContain("ENG-1");
	});

	test("a store or gh check that fails after a turn keeps what it last found, facts included; a store that is gone has nothing", async () => {
		const settings = settingsWith("mention");
		settings.connectors["mcp:linear"] = {
			role: "read",
			scopes: ["mine"],
			reads: [{ id: "mine", tool: "list_my_issues", arguments: {} }],
		};
		const linear = {
			transport: {
				type: "streamableHttp" as const,
				url: "https://mcp.linear.app/mcp",
			},
		};
		let storeError: Error | undefined;
		let ghFails = false;
		let now = 0;
		const reads: string[] = [];
		const connectors = connectorsWith({
			settings,
			loaders: {
				mcp: async () => {
					if (storeError) throw storeError;
					return { mcpServers: { linear } };
				},
				channels: async () => {
					if (storeError) throw storeError;
					return { configured: [{ id: "c", type: "slack" }] };
				},
			},
			gh: new GhReader(
				fakeRun((call) => {
					if (ghFails) throw failure("ETIMEDOUT");
					return ghHandler(call);
				}),
				() => now,
			),
			mcp: {
				registration: async (name) => ({ name, transport: linear.transport }),
				client: async () => ({
					connect: async () => undefined,
					disconnect: async () => undefined,
					callTool: async ({ name }) => {
						reads.push(name);
						return { content: [{ type: "text", text: '["ENG-1"]' }] };
					},
				}),
			},
		});
		const linearFacts = () =>
			connectors
				.all()
				.find((connector) => connector.id === "mcp:linear")
				?.facts?.(repoEnv, 100);
		await connectors.detect();
		await connectors.refresher.start();
		connectors.refresher.stop();
		const read = linearFacts();
		expect(JSON.stringify(read)).toContain("ENG-1");

		storeError = new Error('Failed to parse MCP settings JSON at "mcp.json"');
		ghFails = true;
		now = 300_001;
		await connectors.onTurn({});
		expect(connectors.access("mcp:linear").readAllowed).toBe(true);
		expect(linearFacts()).toEqual(read);
		expect(connectors.access("github").role).toBe("mention");
		expect(connectors.rows().map((row) => row.id)).toContain("channel:slack");

		storeError = Object.assign(new Error("no such file"), { code: "ENOENT" });
		await connectors.onTurn({});
		expect(connectors.all().map((connector) => connector.id)).toEqual([
			"github",
		]);
		expect(connectors.access("mcp:linear").role).toBe("off");
		expect(reads).toEqual(["list_my_issues"]);
	});
});
