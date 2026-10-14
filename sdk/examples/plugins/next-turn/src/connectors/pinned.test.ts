import { describe, expect, test } from "bun:test";
import type { SourceEnv } from "../context/source";
import {
	defaultSettings,
	type PinnedRead,
	parseSettingsFile,
	type Settings,
} from "../settings/settings";
import { connectorAccess } from "./access";
import { GhReader } from "./github/gh";
import { Connectors } from "./index";
import { mcpConnector } from "./mcp";
import {
	bareToolName,
	missingArguments,
	pinnableTools,
	readOnlyToolName,
	summarizeResult,
	toolWords,
} from "./pinned";
import {
	COMPOSIO_READ_NEEDS_U4,
	composioRunner,
	type McpClientPort,
	mcpRunner,
} from "./runners";

const env: SourceEnv = {
	providerId: "anthropic",
	workspaceRoot: "/repo",
	tools: [],
};

describe("which tools a pin may run", () => {
	test("a lookup verb first and no write verb anywhere, as whole words", () => {
		const yes = [
			"list_comments",
			"getWorkflowRuns",
			"search",
			"list-issues",
			"fetch_posts",
			"get_pull_request_status",
		];
		const no = [
			"add_comment",
			"get_and_close_issue",
			"delete_branch",
			"issues",
			"create_issue",
			"list_and_merge",
			"send_message",
			"getAndUpdate",
		];
		for (const name of yes)
			expect([name, readOnlyToolName(name)]).toEqual([name, true]);
		for (const name of no)
			expect([name, readOnlyToolName(name)]).toEqual([name, false]);
		expect(readOnlyToolName("linear_list_issues", "linear")).toBe(true);
		expect(readOnlyToolName("linear_create_issue", "linear")).toBe(false);
		expect(bareToolName("LINEAR_LIST_ISSUES", "linear")).toBe("LIST_ISSUES");
		expect(toolWords("getPRStatus_v2")).toEqual(["get", "prstatus", "v2"]);
	});

	test("the settings page's tool list says why a tool cannot be pinned; pins name their missing arguments", () => {
		expect(
			pinnableTools([{ name: "list_issues" }, { name: "create_issue" }]),
		).toEqual([
			{ name: "list_issues", pinnable: true },
			{
				name: "create_issue",
				pinnable: false,
				reason:
					"Its name does not read as a lookup, so it may change something",
			},
		]);
		expect(
			missingArguments({ required: ["team", "state"] }, { team: "core" }),
		).toEqual(["state"]);
		expect(missingArguments(undefined, {})).toEqual([]);
	});
});

describe("results become one bounded line", () => {
	test("lists as a count and a few names; failures as failures; text as its first line, redacted", () => {
		const issues = [
			{ title: "Fix 405" },
			{ identifier: "ENG-2" },
			{ name: "Docs" },
			{ id: 4 },
			{ title: "Five" },
			{ title: "Six" },
		];
		expect(
			summarizeResult({
				content: [{ type: "text", text: JSON.stringify(issues) }],
			}),
		).toBe("6 items: Fix 405; ENG-2; Docs; 4; Five; …");
		expect(
			summarizeResult({ structuredContent: { issues: [{ title: "One" }] } }),
		).toBe("1 item: One");
		expect(summarizeResult({ successful: true, data: { items: [] } })).toBe(
			"0 items",
		);
		expect(
			summarizeResult({
				isError: true,
				content: [{ type: "text", text: "SECRET STACK" }],
			}),
		).toBe("the read failed");
		expect(summarizeResult({ successful: false, error: "nope" })).toBe(
			"the read failed",
		);
		expect(
			summarizeResult({
				content: [
					{
						type: "text",
						text: "\nDeploy ok with token=abcdefghijklmnop\nmore",
					},
				],
			}),
		).toBe("Deploy ok with token=[redacted]");
		expect(summarizeResult({ title: "Weekly report" })).toBe("Weekly report");
	});
});

describe("running a pin through Cline's MCP client", () => {
	function client(log: string[], fail?: "connect" | "call"): McpClientPort {
		return {
			async connect() {
				log.push("connect");
				if (fail === "connect") throw new Error("refused");
			},
			async callTool({ name, arguments: args }) {
				log.push(`call ${name} ${JSON.stringify(args)}`);
				if (fail === "call") throw new Error("boom");
				return { content: [{ type: "text", text: "[]" }] };
			},
			async disconnect() {
				log.push("disconnect");
			},
		};
	}

	test("connects, calls one tool with the pinned arguments, and always disconnects", async () => {
		const log: string[] = [];
		const runner = await mcpRunner("linear", {
			registration: async () => ({ name: "linear" }),
			client: async () => client(log),
		})();
		expect(typeof runner).toBe("function");
		if (typeof runner !== "function") return;
		expect(await runner("list_issues", { team: "core" })).toEqual({
			content: [{ type: "text", text: "[]" }],
		});
		const failing = await mcpRunner("linear", {
			registration: async () => ({}),
			client: async () => client(log, "call"),
		})();
		if (typeof failing === "function")
			await expect(failing("list_issues", {})).rejects.toThrow("boom");
		expect(log).toEqual([
			"connect",
			'call list_issues {"team":"core"}',
			"disconnect",
			"connect",
			"call list_issues {}",
			"disconnect",
		]);
	});

	test("a missing or disabled server says so; a slow call times out", async () => {
		expect(
			await mcpRunner("gone", {
				registration: async () => undefined,
				client: async () => client([]),
			})(),
		).toEqual({
			reason: 'MCP server "gone" is not in Cline\'s settings, or is disabled',
		});
		const slow: McpClientPort = {
			connect: async () => undefined,
			disconnect: async () => undefined,
			callTool: () => new Promise(() => undefined),
		};
		const runner = await mcpRunner(
			"slow",
			{ registration: async () => ({}), client: async () => slow },
			5,
		)();
		if (typeof runner === "function")
			await expect(runner("list_x", {})).rejects.toThrow(
				"slow/list_x took longer than 5 ms",
			);
	});
});

describe("running a pin through Cline's Composio tools", () => {
	test("until Cline exports its Composio tools, Read says why", async () => {
		expect(await composioRunner(async () => ({}))()).toEqual({
			reason: COMPOSIO_READ_NEEDS_U4,
		});
		expect(
			await composioRunner(async () => ({
				createComposioToolsExtension: async () => undefined,
			}))(),
		).toEqual({
			reason:
				"Composio connectors are off for this Cline account, or none is connected",
		});
	});

	test("once exported, its own tools run with the pinned arguments", async () => {
		const calls: unknown[] = [];
		const core = {
			createComposioToolsExtension: async () => ({
				setup(api: {
					registerTool(tool: unknown): void;
					registerRule(): void;
				}) {
					api.registerRule();
					api.registerTool({
						name: "linear_list_issues",
						execute: (input: unknown) => {
							calls.push(input);
							return { successful: true, data: [{ title: "A" }] };
						},
					});
				},
			}),
		};
		const runner = await composioRunner(async () => core)();
		expect(typeof runner).toBe("function");
		if (typeof runner !== "function") return;
		expect(await runner("linear_list_issues", { assignee: "me" })).toEqual({
			successful: true,
			data: [{ title: "A" }],
		});
		expect(calls).toEqual([{ assignee: "me" }]);
		await expect(runner("linear_create_issue", {})).rejects.toThrow(
			'Cline has no Composio tool "linear_create_issue" in this account',
		);
	});
});

function withReads(
	role: "mention" | "read",
	reads: PinnedRead[],
	scopes: string[],
): Settings {
	const settings = defaultSettings();
	settings.connectors["mcp:linear"] = { role, scopes, reads };
	return settings;
}

describe("an MCP server's pinned reads", () => {
	const pins: PinnedRead[] = [
		{
			id: "mine",
			tool: "list_my_issues",
			arguments: { state: "started" },
			label: "My started issues",
		},
		{ id: "bad", tool: "create_issue", arguments: {} },
	];

	function linear(settings: () => Settings, now: () => number, ran: string[]) {
		return mcpConnector(
			{
				name: "linear",
				transport: "streamableHttp",
				disabled: false,
				target: "mcp.linear.app/mcp",
			},
			{
				enabled: () => true,
				access: () =>
					connectorAccess(settings(), "mcp:linear", true, "anthropic"),
				reads: () => settings().connectors["mcp:linear"]?.reads ?? [],
				runner: async () => async (tool, args) => {
					ran.push(`${tool} ${JSON.stringify(args)}`);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify([{ title: "Fix 405" }, { title: "Docs" }]),
							},
						],
					};
				},
				now,
			},
		);
	}

	test("only read-only pins become scopes; Mention runs nothing", async () => {
		const ran: string[] = [];
		const connector = linear(
			() => withReads("mention", pins, ["mine", "bad"]),
			() => 0,
			ran,
		);
		expect(connector.scopes.map((scope) => scope.id)).toEqual(["mine"]);
		await connector.refresh("mine");
		expect(ran).toEqual([]);
		expect(connector.facts(env)).toMatchObject({
			heading: 'MCP server "linear" (connected; no data read)',
		});
		expect(connector.probe()).toBe("present");
		expect(connector.capabilities()).toEqual(["mcp:linear"]);
	});

	test("Read runs the chosen pin and gives one dated line", async () => {
		const ran: string[] = [];
		let now = 0;
		const connector = linear(
			() => withReads("read", pins, ["mine", "bad"]),
			() => now,
			ran,
		);
		expect(connector.facts(env)).toBe("unknown");
		await connector.refresh("mine");
		await connector.refresh("bad");
		now = 2 * 60_000;
		expect(ran).toEqual(['list_my_issues {"state":"started"}']);
		expect(connector.facts(env)).toEqual({
			heading: 'MCP server "linear" (as of 2m ago)',
			lines: ["My started issues: 2 items: Fix 405; Docs"],
			fetchedAt: 0,
			provenance: { connector: "mcp:linear", route: "mcp:linear" },
		});
	});
});

describe("settings", () => {
	test("pinned reads parse leniently: ids unique, a tool required, arguments an object", () => {
		const file = parseSettingsFile({
			version: 1,
			everywhere: {
				connectors: {
					"mcp:linear": {
						role: "read",
						scopes: ["a"],
						reads: [
							{
								id: "a",
								tool: "list_issues",
								arguments: { team: "core" },
								label: " Mine ",
							},
							{ id: "a", tool: "list_other" },
							{ id: "b" },
							{ id: "c", tool: "search", arguments: "nope" },
						],
					},
				},
			},
		});
		expect(file.everywhere.connectors["mcp:linear"]?.reads).toEqual([
			{
				id: "a",
				tool: "list_issues",
				arguments: { team: "core" },
				label: "Mine",
			},
			{ id: "c", tool: "search", arguments: {} },
		]);
	});
});

describe("Connected to Next Turn, with MCP and Composio reads", () => {
	test("MCP servers get rows; Read opens once a pin exists; the refresher runs pinned reads", async () => {
		const settings = withReads(
			"read",
			[{ id: "mine", tool: "list_my_issues", arguments: {} }],
			["mine"],
		);
		settings.connectors["composio:notion"] = { role: "mention", scopes: [] };
		const ran: string[] = [];
		const connectors = new Connectors({
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
				channels: async () => ({ configured: [] }),
			},
			gh: new GhReader(async () => {
				throw Object.assign(new Error("no gh"), { code: "ENOENT" });
			}),
			composio: composioRunner(async () => ({})),
			mcp: {
				registration: async (name) => ({ name }),
				client: async () => ({
					connect: async () => undefined,
					disconnect: async () => undefined,
					callTool: async ({ name }) => {
						ran.push(name);
						return { content: [{ type: "text", text: "[]" }] };
					},
				}),
			},
			settings: () => settings,
			env: () => env,
		});
		await connectors.detect();
		expect(connectors.all().map((connector) => connector.id)).toEqual([
			"github",
			"composio:notion",
			"mcp:linear",
			"mcp:sentry",
		]);
		const rows = connectors.rows();
		const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
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
		).toBe(COMPOSIO_READ_NEEDS_U4);
		await connectors.refresher.refreshAll("test");
		expect(ran).toEqual(["list_my_issues"]);
	});
});
