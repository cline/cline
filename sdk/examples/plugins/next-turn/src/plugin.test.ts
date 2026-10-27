import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, AgentRunResult } from "@cline/shared";
import {
	Allowance,
	fileLedgerStore,
	type LedgerLine,
} from "./planner/allowance";
import type { Complete, CompleteRequest } from "./planner/completer";
import { RepoReader } from "./planner/repo";
import type { RunCommand } from "./planner/run";
import {
	createNextTurnPlugin,
	factsOf,
	NEXT_TURN_SUGGESTIONS_EVENT,
	pool,
} from "./plugin";
import { summarizeTurn } from "./turn";
import type { NextTurnSuggestionsEvent } from "./types";

const message = (role: "user" | "assistant", parts: unknown[]): AgentMessage =>
	({ id: role, role, content: parts, createdAt: 0 }) as AgentMessage;
const edited = message("assistant", [
	{
		type: "tool-call",
		toolCallId: "edit-1",
		toolName: "write_to_file",
		input: { path: "a.ts" },
	},
	{
		type: "tool-result",
		toolCallId: "edit-1",
		toolName: "write_to_file",
		output: "ok",
	},
]);
const run = (
	status: "completed" | "aborted" | "failed",
	messages: AgentMessage[] = [],
	runId = "run-1",
	outputText = "",
) =>
	({
		agentId: "agent-1",
		runId,
		status,
		iterations: 1,
		outputText,
		messages,
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	}) as AgentRunResult;

test("a completed edit produces verify and review suggestions", () => {
	const facts = factsOf(
		[message("user", [{ type: "text", text: "edit a.ts" }]), edited],
		run("completed"),
	);
	expect(facts).toEqual({
		status: "completed",
		filesEdited: 1,
		toolErrored: false,
	});
	expect(
		pool(facts)
			.slice(0, 3)
			.map((row) => row.kind),
	).toEqual(["verify", "review_diff", "wrap_up"]);
});

test("a tool result with success false is a failure and not an edit", () => {
	const messages = [
		message("user", [{ type: "text", text: "run it" }]),
		message("assistant", [
			{
				type: "tool-call",
				toolCallId: "c1",
				toolName: "run_commands",
				input: { commands: ["bun test"] },
			},
			{
				type: "tool-result",
				toolCallId: "c1",
				toolName: "run_commands",
				output: [
					{
						query: "bun test",
						result: "",
						error: "exit 1",
						success: false,
					},
				],
			},
			{
				type: "tool-call",
				toolCallId: "e1",
				toolName: "editor",
				input: { path: "a.ts" },
			},
			{
				type: "tool-result",
				toolCallId: "e1",
				toolName: "editor",
				output: {
					query: "edit:a.ts",
					result: "",
					error: "conflict",
					success: false,
				},
			},
		]),
	];
	expect(factsOf(messages, run("completed"))).toEqual({
		status: "completed",
		filesEdited: 0,
		toolErrored: true,
	});
	expect(
		summarizeTurn(messages, run("completed")).context.tools.map((tool) => [
			tool.name,
			tool.failed,
			tool.error,
		]),
	).toEqual([
		["run_commands", true, "exit 1"],
		["editor", true, "conflict"],
	]);
});

test("afterRun emits a bounded backend suggestion event for the root run", async () => {
	const events: Array<{ name: string; payload: unknown }> = [];
	const plugin = createNextTurnPlugin();
	plugin.setup?.(
		{} as never,
		{
			emitEvent: (name: string, payload: unknown) =>
				events.push({ name, payload }),
		} as never,
	);
	await plugin.hooks?.afterRun?.({
		snapshot: {},
		result: run("completed", [
			message("user", [{ type: "text", text: "edit a.ts" }]),
			edited,
		]),
	} as never);
	expect(events).toHaveLength(1);
	expect(events[0]?.name).toBe(NEXT_TURN_SUGGESTIONS_EVENT);
	expect(events[0]?.payload).toMatchObject({
		runId: "run-1",
		status: "completed",
		source: "rules",
	});
	expect(
		(events[0]?.payload as { suggestions: unknown[] }).suggestions,
	).toHaveLength(3);
});

test("failed runs lead with a fix and subagent runs stay silent", async () => {
	const events: unknown[] = [];
	const plugin = createNextTurnPlugin();
	plugin.setup?.(
		{} as never,
		{
			emitEvent: (name: string, payload: unknown) =>
				events.push({ name, payload }),
		} as never,
	);
	await plugin.hooks?.afterRun?.({
		snapshot: {},
		result: run("failed"),
	} as never);
	expect(
		(events[0] as { payload: { suggestions: Array<{ kind: string }> } }).payload
			.suggestions[0]?.kind,
	).toBe("fix_failure");
	await plugin.hooks?.afterRun?.({
		snapshot: { parentAgentId: "parent" },
		result: run("completed"),
	} as never);
	expect(events).toHaveLength(1);
});

test("the plugin manifest is root-only", () => {
	expect(createNextTurnPlugin().manifest.rootOnly).toBe(true);
});

test("plain completed answers still produce ignorable suggestions", () => {
	expect(
		pool({
			status: "completed",
			filesEdited: 0,
			toolErrored: false,
		}).map((suggestion) => suggestion.kind),
	).toEqual(["wrap_up", "next_step"]);
});

test("failed-run prompts use plain punctuation", () => {
	const prompt = pool({
		status: "failed",
		filesEdited: 0,
		toolErrored: false,
	})[0]?.prompt;
	expect(prompt).toBe("Retry the last turn. It ended in an error.");
	expect(prompt).not.toContain("—");
});

const MODEL_ANSWER = JSON.stringify({
	suggestions: [
		{
			kind: "verify",
			prompt: "Run bun test src/client.test.ts against the retry change.",
			reason: "client.ts changed and nothing has run its tests",
		},
		{
			kind: "review_diff",
			prompt: "Review the backoff constants I added in src/client.ts.",
			reason: "new constants",
		},
	],
});

const GIT_STATUS = [
	"# branch.oid 0123456789abcdef0123456789abcdef01234567",
	"# branch.head harrison/retry",
	"# branch.upstream origin/harrison/retry",
	"# branch.ab +2 -0",
	"1 .M N... 100644 100644 100644 aaaa bbbb src/client.ts",
	"? notes.md",
].join("\n");

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

type Pending = {
	request: CompleteRequest;
	answer(text: string | null): void;
	fail(error: Error): void;
};

function harness(
	options: { callsPerHour?: number; timeoutMs?: number; run?: RunCommand } = {},
) {
	const dir = mkdtempSync(join(tmpdir(), "next-turn-"));
	dirs.push(dir);
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ scripts: { check: "tsc", dev: "x" } }),
	);
	writeFileSync(join(dir, "bun.lock"), "");
	const ledgerPath = join(dir, "data", "planner.jsonl");
	const events: NextTurnSuggestionsEvent[] = [];
	const pending: Pending[] = [];
	const complete: Complete = (request) =>
		new Promise((resolve, reject) => {
			pending.push({
				request,
				answer: (text) => resolve(text === null ? null : { text }),
				fail: reject,
			});
		});
	const plugin = createNextTurnPlugin({
		planner: {
			complete,
			allowance: new Allowance(
				fileLedgerStore(ledgerPath),
				options.callsPerHour,
			),
			run: options.run ?? (async () => GIT_STATUS),
			repo: new RepoReader(),
			timeoutMs: options.timeoutMs,
		},
	});
	plugin.setup?.(
		{} as never,
		{
			session: { sessionId: "sess-1" },
			workspaceInfo: { rootPath: dir },
			emitEvent: (_name: string, payload: unknown) =>
				events.push(payload as NextTurnSuggestionsEvent),
		} as never,
	);
	const finish = (
		runId: string,
		status: "completed" | "aborted" | "failed" = "completed",
		options: { provider?: boolean; request?: string } = {},
	) =>
		plugin.hooks?.afterRun?.({
			snapshot: {},
			result: run(
				status,
				[
					message("user", [
						{ type: "text", text: options.request ?? "edit a.ts" },
					]),
					edited,
					{
						...message("assistant", [{ type: "text", text: "Edited a.ts." }]),
						...(options.provider === false
							? {}
							: { modelInfo: { provider: "anthropic", id: "claude-x" } }),
					},
				],
				runId,
				"Edited a.ts.",
			),
		} as never);
	const ledger = (): LedgerLine[] => {
		try {
			return readFileSync(ledgerPath, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as LedgerLine);
		} catch {
			return [];
		}
	};
	return { plugin, events, pending, finish, ledger, dir };
}

async function until(done: () => boolean, label = "condition"): Promise<void> {
	for (let waited = 0; !done(); waited += 1) {
		if (waited > 500) throw new Error(`timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test("the rule set goes out before the model answers, and the model set replaces it for the same run", async () => {
	const { events, pending, finish } = harness();
	await finish("run-1");
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({ runId: "run-1", source: "rules" });
	await until(() => pending.length === 1, "the planner call");
	pending[0]?.answer(MODEL_ANSWER);
	await until(() => events.length === 2, "the model set");
	expect(events[1]).toMatchObject({
		runId: "run-1",
		status: "completed",
		source: "model",
	});
	expect(events[1]?.suggestions).toEqual([
		{
			kind: "verify",
			label: "Verify",
			prompt: "Run bun test src/client.test.ts against the retry change.",
			reason: "client.ts changed and nothing has run its tests",
		},
		{
			kind: "review_diff",
			label: "Review",
			prompt: "Review the backoff constants I added in src/client.ts.",
			reason: "new constants",
		},
	]);
});

test("afterRun returns while the model call is still pending", async () => {
	const { events, pending, finish } = harness();
	await finish("run-1");
	expect(pending).toHaveLength(0);
	expect(events).toHaveLength(1);
});

test("the planner reads the turn, the git state and the repository's commands, redacted", async () => {
	const { pending, finish } = harness();
	await finish("run-1", "completed", {
		request: "make the client retry. token=aaaaaaaaaa",
	});
	await until(() => pending.length === 1, "the planner call");
	const { input, chat, sessionId } = pending[0]?.request ?? {};
	expect(chat).toEqual({ providerId: "anthropic", modelId: "claude-x" });
	expect(sessionId).toBe("sess-1");
	expect(input?.system).toContain(
		"You suggest the next message a person could send to their coding agent",
	);
	expect(input?.user).toContain("## The turn that just ended");
	expect(input?.user).toContain("make the client retry. token=[redacted]");
	expect(input?.user).not.toContain("aaaaaaaaaa");
	expect(input?.user).toContain("- write_to_file: ok");
	expect(input?.user).toContain("- a.ts");
	expect(input?.user).toContain("Branch: harrison/retry (012345678)");
	expect(input?.user).toContain("Working tree: 2 changed files");
	expect(input?.user).toContain("- Changed: M src/client.ts");
	expect(input?.user).toContain("- Script: `bun run check`");
	expect(input?.user).not.toContain("bun run dev");
});

test("a run that starts after the planner call began makes its answer stale", async () => {
	const { plugin, events, pending, finish } = harness();
	await finish("run-1");
	await until(() => pending.length === 1, "the first planner call");
	await plugin.hooks?.beforeRun?.({ snapshot: {} } as never);
	expect(pending[0]?.request.signal.aborted).toBe(true);
	pending[0]?.answer(MODEL_ANSWER);
	await settle();
	expect(events.map((event) => event.source)).toEqual(["rules"]);
});

test("an answer that lands in the same tick a new run starts is dropped", async () => {
	const { plugin, events, pending, finish, ledger } = harness();
	await finish("run-1");
	await until(() => pending.length === 1, "the planner call");
	pending[0]?.answer(MODEL_ANSWER);
	plugin.hooks?.beforeRun?.({ snapshot: {} } as never);
	await until(() => ledger().length === 1, "the ledger line");
	expect(events.map((event) => event.source)).toEqual(["rules"]);
	expect(ledger()[0]?.outcome).toBe("aborted");
});

test("an answer for an older run is dropped even when its call ignored the abort", async () => {
	const { events, pending, finish, ledger } = harness();
	await finish("run-1");
	await until(() => pending.length === 1, "run 1's planner call");
	await finish("run-2");
	await until(() => pending.length === 2, "run 2's planner call");
	pending[0]?.answer(MODEL_ANSWER);
	await settle();
	expect(events.map((event) => [event.runId, event.source])).toEqual([
		["run-1", "rules"],
		["run-2", "rules"],
	]);
	pending[1]?.answer(MODEL_ANSWER);
	await until(() => events.length === 3, "run 2's model set");
	expect(events[2]).toMatchObject({ runId: "run-2", source: "model" });
	expect(ledger().map((line) => line.outcome)).toEqual(["aborted", "ok"]);
});

test("a model failure keeps the rule set and says nothing", async () => {
	const { events, pending, finish, ledger } = harness();
	await finish("run-1");
	await until(() => pending.length === 1, "the planner call");
	pending[0]?.fail(new Error("provider down"));
	await until(() => ledger().length === 1, "the ledger line");
	expect(events.map((event) => event.source)).toEqual(["rules"]);
	expect(ledger()[0]?.outcome).toBe("error");
});

test("an answer with no usable row is rejected and the rule set stays", async () => {
	const { events, pending, finish, ledger } = harness();
	await finish("run-1");
	await until(() => pending.length === 1, "the planner call");
	pending[0]?.answer(
		JSON.stringify({
			suggestions: [
				{ kind: "delete_everything", prompt: "Delete the repository now." },
				{ kind: "verify", prompt: "x" },
			],
		}),
	);
	await until(() => ledger().length === 1, "the ledger line");
	expect(events.map((event) => event.source)).toEqual(["rules"]);
	expect(ledger()[0]?.outcome).toBe("unparseable");
});

test("a call that outlasts the timeout is aborted and the rule set stays", async () => {
	const { events, pending, finish, ledger } = harness({ timeoutMs: 20 });
	await finish("run-1");
	await until(() => pending.length === 1, "the planner call");
	await until(() => ledger().length === 1, "the ledger line");
	expect(pending[0]?.request.signal.aborted).toBe(true);
	expect(ledger()[0]?.outcome).toBe("timeout");
	pending[0]?.answer(MODEL_ANSWER);
	await settle();
	expect(events.map((event) => event.source)).toEqual(["rules"]);
});

test("the hourly allowance caps the model calls and the rule set still goes out", async () => {
	const { events, pending, finish } = harness({ callsPerHour: 2 });
	for (const runId of ["run-1", "run-2"]) {
		await finish(runId);
		await until(() => pending.length === (runId === "run-1" ? 1 : 2));
		pending.at(-1)?.answer(MODEL_ANSWER);
		await until(
			() => events.filter((event) => event.source === "model").length > 0,
		);
		events.length = 0;
	}
	await finish("run-3");
	await settle();
	expect(pending).toHaveLength(2);
	expect(events.map((event) => [event.runId, event.source])).toEqual([
		["run-3", "rules"],
	]);
});

test("the allowance is shared through the ledger file across plugin instances", async () => {
	const first = harness({ callsPerHour: 1 });
	await first.finish("run-1");
	await until(() => first.pending.length === 1);
	first.pending[0]?.answer(MODEL_ANSWER);
	await until(() => first.ledger().length === 1);
	const dir = first.dir;
	const second = createNextTurnPlugin({
		planner: {
			complete: () => {
				throw new Error("the allowance should have stopped this call");
			},
			allowance: new Allowance(
				fileLedgerStore(join(dir, "data", "planner.jsonl")),
				1,
			),
			run: async () => GIT_STATUS,
			repo: new RepoReader(),
		},
	});
	const events: NextTurnSuggestionsEvent[] = [];
	second.setup?.(
		{} as never,
		{
			session: { sessionId: "sess-1" },
			workspaceInfo: { rootPath: dir },
			emitEvent: (_name: string, payload: unknown) =>
				events.push(payload as NextTurnSuggestionsEvent),
		} as never,
	);
	await second.hooks?.afterRun?.({
		snapshot: {},
		result: run(
			"completed",
			[
				message("user", [{ type: "text", text: "go" }]),
				{
					...message("assistant", [{ type: "text", text: "done" }]),
					modelInfo: { provider: "anthropic", id: "claude-x" },
				},
			],
			"run-9",
		),
	} as never);
	await settle();
	expect(events.map((event) => event.source)).toEqual(["rules"]);
});

test("a chat with no known provider is never sent to a model and costs no allowance", async () => {
	const { events, pending, finish, ledger } = harness({ callsPerHour: 1 });
	await finish("run-1", "completed", { provider: false });
	await settle();
	expect(pending).toHaveLength(0);
	await finish("run-2");
	await until(() => pending.length === 1, "run 2's planner call");
	pending[0]?.answer(null);
	await settle();
	expect(ledger()).toEqual([]);
	await finish("run-3");
	await until(() => pending.length === 2, "run 3's planner call");
	expect(events.map((event) => event.source)).toEqual([
		"rules",
		"rules",
		"rules",
	]);
});

test("after a failed turn the first suggestion deals with the failure even when the model skipped it", async () => {
	const { events, pending, finish } = harness();
	await finish("run-1", "failed");
	await until(() => pending.length === 1, "the planner call");
	pending[0]?.answer(MODEL_ANSWER);
	await until(() => events.length === 2, "the model set");
	expect(events[1]?.suggestions[0]).toMatchObject({
		kind: "fix_failure",
		prompt: "Retry the last turn. It ended in an error.",
	});
	expect(events[1]?.suggestions.map((row) => row.kind)).toEqual([
		"fix_failure",
		"verify",
		"review_diff",
	]);
});

test("subagent runs are not planned and ending the session aborts the call", async () => {
	const { plugin, pending, finish } = harness();
	await plugin.hooks?.afterRun?.({
		snapshot: { parentAgentId: "parent" },
		result: run("completed"),
	} as never);
	await settle();
	expect(pending).toHaveLength(0);
	await finish("run-1");
	await until(() => pending.length === 1, "the planner call");
	let cleanup: (() => void | Promise<void>) | undefined;
	plugin.setup?.(
		{} as never,
		{ onDispose: (fn: () => void) => (cleanup = fn) } as never,
	);
	await cleanup?.();
	expect(pending[0]?.request.signal.aborted).toBe(true);
});

test("a workspace that is not a repository still plans, with no git section", async () => {
	const failure = Object.assign(new Error("not a git repository"), {
		code: 128,
	});
	const { pending, finish } = harness({
		run: async () => {
			throw failure;
		},
	});
	await finish("run-1");
	await until(() => pending.length === 1, "the planner call");
	expect(pending[0]?.request.input.user).not.toContain("git state");
	expect(pending[0]?.request.input.user).not.toContain("Could not read");
});

test("a git read that fails says the tree is unknown, not clean", async () => {
	const { pending, finish } = harness({
		run: async () => {
			throw new Error("git is locked");
		},
	});
	await finish("run-1");
	await until(() => pending.length === 1, "the planner call");
	expect(pending[0]?.request.input.user).toContain(
		"- This folder's git state — treat as unknown, not empty.",
	);
});

test("rule-only mode never plans", async () => {
	const events: NextTurnSuggestionsEvent[] = [];
	const plugin = createNextTurnPlugin({ planner: false });
	plugin.setup?.(
		{} as never,
		{
			emitEvent: (_name: string, payload: unknown) =>
				events.push(payload as NextTurnSuggestionsEvent),
		} as never,
	);
	await plugin.hooks?.afterRun?.({
		snapshot: {},
		result: run("completed", [
			message("user", [{ type: "text", text: "edit a.ts" }]),
			{
				...message("assistant", [{ type: "text", text: "done" }]),
				modelInfo: { provider: "anthropic", id: "claude-x" },
			},
		]),
	} as never);
	await settle();
	expect(events.map((event) => event.source)).toEqual(["rules"]);
});
