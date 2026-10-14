import { describe, expect, test } from "bun:test";
import type { McpServerRegistration } from "@cline/core";
import type { SourceEnv } from "../context/source";
import {
	defaultSettings,
	type PinnedRead,
	type Settings,
} from "../settings/settings";
import { connectorAccess } from "./access";
import { composioConnector } from "./composio";
import { mcpConnector } from "./mcp";
import {
	missingArguments,
	pinnableTools,
	type ResolveRunner,
	readOnlyToolName,
	summarizeResult,
	type ToolRunner,
} from "./pinned";
import { type McpClientPort, mcpRunner } from "./runners";

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
		expect(readOnlyToolName("LINEAR_LIST_ISSUES", "linear")).toBe(true);
		expect(readOnlyToolName("getPRStatus_v2")).toBe(true);
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

const LINEAR: McpServerRegistration = {
	name: "linear",
	transport: { type: "streamableHttp", url: "https://mcp.linear.app/mcp" },
};

async function runnable(resolve: ResolveRunner): Promise<ToolRunner> {
	const runner = await resolve();
	if (typeof runner !== "function") throw new Error(runner.reason);
	return runner;
}

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
		const runner = await runnable(
			mcpRunner("linear", {
				registration: async () => LINEAR,
				client: async () => client(log),
			}),
		);
		expect(await runner("list_issues", { team: "core" })).toEqual({
			content: [{ type: "text", text: "[]" }],
		});
		const failing = await runnable(
			mcpRunner("linear", {
				registration: async () => LINEAR,
				client: async () => client(log, "call"),
			}),
		);
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
		const runner = await runnable(
			mcpRunner(
				"slow",
				{ registration: async () => LINEAR, client: async () => slow },
				5,
			),
		);
		await expect(runner("list_x", {})).rejects.toThrow(
			"slow/list_x took longer than 5 ms",
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
		});
	});
});

describe("a Composio toolkit's connector", () => {
	test("Mention names it and the route the agent can use; Off makes it absent", () => {
		const settings = defaultSettings();
		const notion = composioConnector("notion", {
			access: () =>
				connectorAccess(settings, "composio:notion", true, "anthropic"),
			reads: () => [],
		});
		expect(notion.probe()).toBe("present");
		expect(notion.facts(env)).toEqual({
			heading: "notion (connected; no data read)",
			lines: [
				"Suggestions may ask the agent to use its tools, through Composio, through your Cline account.",
			],
		});
		settings.connectors["composio:notion"] = { role: "off", scopes: [] };
		expect(notion.probe()).toBe("absent");
	});
});
