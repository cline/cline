import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	Agent,
	countUserRunMessages as coreCount,
	getUserRunSpan as coreSpan,
	createTool,
} from "@cline/core";
import type { AgentMessage, AgentRunResult } from "@cline/shared";
import { createNextTurnPlugin, type SetupContext } from "../plugin";
import { type SessionRuntime, sessionEnv } from "../runtime";
import { defaultSettings } from "../settings/settings";
import { EMPTY_BACKLOG } from "./backlog";
import { fnv1a32 } from "./candidates";
import { LabelLog } from "./labels";
import type { Complete } from "./model";
import { NextSession, type OfferedSet } from "./next";
import {
	countUserRunMessages,
	deriveTurn,
	deriveTurnFromTranscript,
	getUserRunSpan,
	lastPersonMessage,
	type MessageLike,
} from "./turn";

type RuntimeConfig = ConstructorParameters<typeof Agent>[0];
type Model = Extract<RuntimeConfig, { model: unknown }>["model"];

let ids = 0;
function message(
	role: AgentMessage["role"],
	content: AgentMessage["content"],
	metadata?: Record<string, unknown>,
): AgentMessage {
	ids += 1;
	return {
		id: `m${ids}`,
		role,
		content,
		createdAt: ids,
		...(metadata ? { metadata } : {}),
	};
}

function text(value: string): AgentMessage["content"] {
	return [{ type: "text", text: value }];
}

function run(messages: AgentMessage[]): AgentRunResult {
	return {
		agentId: "a",
		runId: "run_1",
		status: "completed",
		iterations: 1,
		outputText: "Done.",
		messages,
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	};
}

/** The turn, held to the acceptance rule: its run count is core's count of the same transcript. */
function turnOf(messages: AgentMessage[], sessionId = "s") {
	const turn = deriveTurn(sessionId, run(messages));
	expect(turn?.runCount).toBe(coreCount(messages));
	return turn;
}

const IMAGE = {
	type: "image",
	image: "data:image/png;base64,AAAA",
	mediaType: "image/png",
} as const;
const RESUME =
	'<user_input mode="act">[TASK RESUMPTION] Please continue where you left off.</user_input>';
const ACT_APPROVAL =
	"The user approved switching to act mode. Continue with the approved plan now.";
const MODE_NOTICE =
	"<mode_notice>The user switched from plan mode to act mode before sending this message.</mode_notice>";
const HOOK_BLOCK =
	'<hook_context source="RunStart">\nThe working tree has uncommitted changes.\n</hook_context>';

/** Spans with a name and the answer core gives at 0.0.92, so a reader sees what each kind of message counts for. */
const NAMED_SPANS: ReadonlyArray<readonly [string, MessageLike, number]> = [
	["a typed prompt", { role: "user", content: "Build it" }, 1],
	["an assistant reply", { role: "assistant", content: "Done" }, 0],
	[
		"a tool result",
		{
			role: "user",
			content: [{ type: "tool_result", tool_use_id: "c1", content: "done" }],
		},
		0,
	],
	[
		"media inside a tool result",
		{
			role: "user",
			content: [{ type: "tool-result", toolCallId: "c2", output: "ok" }, IMAGE],
		},
		0,
	],
	["an image alone", { role: "user", content: [IMAGE] }, 1],
	[
		"a file alone",
		{ role: "user", content: [{ type: "file", path: "a.ts", content: "x" }] },
		1,
	],
	[
		"a compaction summary of three runs",
		{
			role: "user",
			content: "Context summary",
			metadata: {
				kind: "compaction_summary",
				displayRole: "system",
				userRunSpan: 3,
			},
		},
		3,
	],
	[
		"basic compaction's first prompt",
		{
			role: "user",
			content: "Fix it",
			metadata: {
				kind: "compaction",
				reason: "auto_compaction",
				displayRole: "system",
				userRunSpan: 1,
			},
		},
		1,
	],
	[
		"a summary with no stored span",
		{
			role: "user",
			content: "Legacy summary",
			metadata: { kind: "compaction_summary" },
		},
		1,
	],
	[
		"a compaction with a malformed span",
		{
			role: "user",
			content: "Malformed",
			metadata: { kind: "compaction", userRunSpan: -2 },
		},
		1,
	],
	[
		"a stored span of two",
		{ role: "user", content: "Two runs", metadata: { userRunSpan: 2 } },
		2,
	],
	[
		"a steer",
		{
			role: "user",
			content: "also keep the old name",
			metadata: { userRunSpan: 0 },
		},
		0,
	],
	[
		"a [SYSTEM] reminder",
		{
			role: "user",
			content: "[SYSTEM] Finish the checklist first.",
			metadata: { userRunSpan: 0 },
		},
		0,
	],
	[
		"a recovery notice",
		{
			role: "user",
			content: "Recovered context",
			metadata: { kind: "recovery_notice" },
		},
		0,
	],
	["a resumption prompt", { role: "user", content: RESUME }, 0],
	[
		"a resumption prompt with an image",
		{ role: "user", content: [{ type: "text", text: RESUME }, IMAGE] },
		1,
	],
	["the act-mode approval", { role: "user", content: ACT_APPROVAL }, 0],
	["a mode notice alone", { role: "user", content: MODE_NOTICE }, 0],
	[
		"a mode notice before a prompt",
		{
			role: "user",
			content: `${MODE_NOTICE}<user_input mode="act">Ship it</user_input>`,
		},
		1,
	],
	[
		"a slash command with no arguments",
		{ role: "user", content: '<user_command slash="review"></user_command>' },
		1,
	],
	[
		"hook context as core writes it",
		{
			role: "user",
			content: HOOK_BLOCK,
			metadata: { userRunSpan: 0, displayRole: "system" },
		},
		0,
	],
	[
		"hook context in an older transcript",
		{ role: "user", content: HOOK_BLOCK },
		1,
	],
	["an empty message", { role: "user", content: "   " }, 0],
	["content core cannot see", { role: "user" }, 1],
];

const CONTENTS: readonly unknown[] = [
	"Build it",
	"",
	"   ",
	RESUME,
	"  [TASK RESUMPTION] go on",
	ACT_APPROVAL,
	`<user_input mode="plan">${ACT_APPROVAL}</user_input>`,
	'<user_input mode="act"></user_input>',
	'<user_input mode="act">',
	MODE_NOTICE,
	`${MODE_NOTICE}<user_input mode="act">[TASK RESUMPTION] y</user_input>`,
	"<mode_notice>never closed",
	'<user_command slash="review">check the diff</user_command>',
	'<user_command slash="team">spawn a team of agents for the following task: x</user_command>',
	'<USER_COMMAND SLASH="Team"></USER_COMMAND>',
	'<user_command slash="">[TASK RESUMPTION] x</user_command>',
	'<user_command slash="  ">x</user_command>',
	'<user_command slash="x">[TASK RESUMPTION] y</user_command>',
	'<user_command slash="x">',
	HOOK_BLOCK,
	undefined,
	42,
	{ text: "an object, not parts" },
	[],
	[{ type: "text", text: "Build it" }],
	[{ type: "text", text: "" }, IMAGE],
	[IMAGE],
	[{ type: "file", path: "a.ts", content: "x" }],
	[{ type: "media", media: {} }],
	[{ type: "tool-result", toolCallId: "c", toolName: "t", output: "ok" }],
	[{ type: "tool_result", tool_use_id: "c", content: "done" }, IMAGE],
	[{ type: "text", text: "[TASK RESUMPTION] go" }, IMAGE],
	[null, "x", ["y"], { type: "text", text: 5 }, { type: "text", text: "ok" }],
	[
		{ type: "text", text: '<user_input mode="act">' },
		{ type: "text", text: "Hi</user_input>" },
	],
];

const METADATA: readonly unknown[] = [
	undefined,
	null,
	[],
	"compaction",
	{},
	{ kind: "compaction", userRunSpan: 3 },
	{ kind: "compaction_summary" },
	{ kind: "compaction", userRunSpan: -2 },
	{ kind: "compaction_summary", userRunSpan: 1.5 },
	{ kind: "compaction", userRunSpan: 0 },
	{ userRunSpan: 0 },
	{ userRunSpan: 2 },
	{ userRunSpan: "1" },
	{ kind: "recovery_notice" },
	{ kind: "completion_reminder", userRunSpan: 1 },
	{ kind: "a kind core does not know" },
	{ kind: 5 },
	{ displayRole: "system", userRunSpan: 0 },
];

const ROLES: readonly unknown[] = [
	"user",
	"assistant",
	"tool",
	"system",
	"status",
	"error",
	undefined,
	7,
];

/** Every content shape under every metadata shape, plus every role: each branch of core's span, both ways. */
const CORPUS: readonly MessageLike[] = [
	...METADATA.flatMap((metadata) =>
		CONTENTS.map((content) => ({ role: "user", content, metadata })),
	),
	...ROLES.map((role) => ({ role, content: "Build it" })),
];

describe("the run count, vendored from core", () => {
	test("each named message counts for what core counts it for", () => {
		expect(
			NAMED_SPANS.map(([name, item]) => [
				name,
				coreSpan(item),
				getUserRunSpan(item),
			]),
		).toEqual(NAMED_SPANS.map(([name, , span]) => [name, span, span]));
	});

	test("the copy gives core's span for every message in the corpus, and core's count for the whole", () => {
		const label = (item: MessageLike) => JSON.stringify(item) ?? "";
		expect(CORPUS.map((item) => [label(item), getUserRunSpan(item)])).toEqual(
			CORPUS.map((item) => [label(item), coreSpan(item)]),
		);
		expect(countUserRunMessages(CORPUS)).toBe(coreCount(CORPUS));
		expect(countUserRunMessages(undefined)).toBe(coreCount(undefined));
	});
});

const editor = createTool({
	name: "editor",
	description: "A deterministic test fixture; writes nothing.",
	inputSchema: {
		type: "object",
		properties: { path: { type: "string" } },
		additionalProperties: false,
	},
	execute: async () => "ok",
});

/** Edits `src/flaky.ts` on its first call and answers in text after. */
function editingModel(): { model: Model; calls: () => number } {
	let calls = 0;
	return {
		calls: () => calls,
		model: {
			async *stream() {
				calls += 1;
				if (calls === 1) {
					yield {
						type: "tool-call-delta",
						index: 0,
						toolCallId: `c${calls}`,
						toolName: "editor",
						input: { path: "src/flaky.ts" },
					};
					yield { type: "finish", reason: "tool-calls" };
				} else {
					yield { type: "text-delta", text: `Done (${calls}).` };
					yield { type: "finish", reason: "stop" };
				}
			},
		},
	};
}

describe("the turn's identity is core's run count", () => {
	test("a compaction summary counts the runs it folded (span 3)", () => {
		const summary = message(
			"user",
			text("Context summary:\n\nThe person asked for three fixes."),
			{ kind: "compaction_summary", displayRole: "system", userRunSpan: 3 },
		);
		const prompt = message("user", text("Now add the tests"));
		const turn = turnOf([
			summary,
			message("assistant", text("Fixed.")),
			prompt,
			message("assistant", text("Added.")),
		]);
		expect(coreSpan(summary)).toBe(3);
		expect(turn).toMatchObject({
			runCount: 4,
			turnKey: "s:4",
			userMessageId: prompt.id,
			context: { request: "Now add the tests" },
		});
	});

	test("a steer and a [SYSTEM] reminder, as the runtime writes them, open no run (span 0)", async () => {
		const scripted = editingModel();
		let reminded = false;
		const agent = new Agent({
			model: scripted.model,
			tools: [editor],
			consumePendingUserMessage: () =>
				scripted.calls() === 1 ? "also keep the old name" : undefined,
			completionPolicy: {
				completionGuard: () => {
					if (reminded) return undefined;
					reminded = true;
					return "[SYSTEM] Finish the checklist before you stop.";
				},
			},
		});
		const first = await agent.run("Fix the flaky test");
		const users = first.messages.filter((item) => item.role === "user");
		expect(users.map((item) => [textOfParts(item), coreSpan(item)])).toEqual([
			["Fix the flaky test", 1],
			["also keep the old name", 0],
			["[SYSTEM] Finish the checklist before you stop.", 0],
		]);
		const turn = turnOf([...first.messages]);
		expect(turn).toMatchObject({
			runCount: 1,
			turnKey: "s:1",
			userMessageId: users[0]?.id,
			facts: { filesEdited: 1 },
		});
		expect(lastPersonMessage(first.messages)?.text).toBe("Fix the flaky test");
		const second = await agent.run("Now update the docs");
		expect(turnOf([...second.messages])).toMatchObject({
			runCount: 2,
			turnKey: "s:2",
			context: { request: "Now update the docs" },
		});
	});

	test("a [TASK RESUMPTION] prompt carries the person's run on, so the turn and its message stay the same", () => {
		const ask = message("user", text("Migrate the config"));
		const messages = [
			ask,
			message("assistant", [
				{
					type: "tool-call",
					toolCallId: "c1",
					toolName: "editor",
					input: { path: "config.ts" },
				},
			]),
			message("tool", [
				{
					type: "tool-result",
					toolCallId: "c1",
					toolName: "editor",
					output: "ok",
				},
			]),
			message("user", text(RESUME)),
			message("user", text(ACT_APPROVAL)),
			message("assistant", [
				{
					type: "tool-call",
					toolCallId: "c2",
					toolName: "editor",
					input: { path: "config.test.ts" },
				},
			]),
		];
		const turn = turnOf(messages);
		expect(turn).toMatchObject({
			runCount: 1,
			userMessageId: ask.id,
			facts: { filesEdited: 2 },
		});
		expect(lastPersonMessage(messages)?.id).toBe(ask.id);
	});

	test("hook context is never the person's message, with or without the span core now writes", () => {
		const ask = message("user", text("Fix it"));
		const marked = message("user", text(HOOK_BLOCK), {
			userRunSpan: 0,
			displayRole: "system",
		});
		expect(turnOf([ask, marked])).toMatchObject({
			runCount: 1,
			userMessageId: ask.id,
			context: { request: "Fix it" },
		});
		const unmarked = message("user", text(HOOK_BLOCK));
		const bare = message("user", text("<hook_context>injected</hook_context>"));
		expect(turnOf([ask, unmarked, bare])).toMatchObject({
			runCount: 3,
			userMessageId: ask.id,
			context: { request: "Fix it" },
		});
	});

	test("an image-only message is the person's, with an empty request", () => {
		const image = message("user", [IMAGE]);
		const messages = [
			message("user", text("Match this mock")),
			message("assistant", text("Which one?")),
			image,
			message("assistant", [
				{
					type: "tool-call",
					toolCallId: "c1",
					toolName: "editor",
					input: { path: "src/card.tsx" },
				},
			]),
		];
		expect(turnOf(messages)).toMatchObject({
			runCount: 2,
			turnKey: "s:2",
			userMessageId: image.id,
			facts: { filesEdited: 1 },
			context: { request: "" },
		});
		expect(lastPersonMessage(messages)).toEqual({ id: image.id, text: "" });
	});

	test("a non-root run counts its own transcript, so the plugin serves only the root's", async () => {
		const context: SetupContext = {
			session: { sessionId: "sess_1" },
			client: { name: "cline-cli" },
			workspaceInfo: { rootPath: "/w" },
		};
		const sets: (OfferedSet | undefined)[] = [];
		const next = new NextSession({
			sessionId: "sess_1",
			settings: defaultSettings,
			env: sessionEnv(context, () => []),
			sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
			backlog: async () => EMPTY_BACKLOG,
			labels: new LabelLog(
				join(
					mkdtempSync(join(tmpdir(), "next-turn-identity-")),
					"labels.jsonl",
				),
			),
		});
		next.onSet((set) => sets.push(set));
		const runtime: SessionRuntime = {
			engine: undefined as never,
			next,
			setTools: () => undefined,
			stop: () => undefined,
		};
		const plugin = createNextTurnPlugin({ startRuntime: () => runtime });
		await plugin.setup?.(
			{} as Parameters<NonNullable<typeof plugin.setup>>[0],
			context,
		);
		const root = new Agent({
			model: editingModel().model,
			tools: [editor],
			hooks: plugin.hooks,
		});
		await root.run("Add a retry to the client");
		expect(sets.map((set) => set?.turnKey)).toEqual(["sess_1:1"]);
		const sub = new Agent({
			model: editingModel().model,
			tools: [editor],
			hooks: plugin.hooks,
			parentAgentId: "agent_root",
		});
		const delegated = await sub.run("Investigate the parser");
		expect(turnOf([...delegated.messages], "sess_1")).toMatchObject({
			runCount: 1,
			turnKey: "sess_1:1",
		});
		expect(sets.map((set) => set?.turnKey)).toEqual(["sess_1:1"]);
	});

	test("a model pool is reused on a resume and asked again for a new message at the same position", async () => {
		const asked: string[] = [];
		const complete: Complete = async (input) => {
			asked.push(input.user);
			return {
				text: '{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run the flaky test ten times.","why":"it was flaky"}]}',
			};
		};
		const context: SetupContext = {
			session: { sessionId: "s" },
			client: { name: "cline-cli" },
			workspaceInfo: { rootPath: "/w" },
		};
		const session = new NextSession({
			sessionId: "s",
			settings: defaultSettings,
			env: sessionEnv(context, () => []),
			sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
			backlog: async () => EMPTY_BACKLOG,
			complete,
			labels: new LabelLog(
				join(mkdtempSync(join(tmpdir(), "next-turn-pool-")), "labels.jsonl"),
			),
		});
		const ask = message("user", text("Fix the flaky test"));
		await session.afterRun(run([ask]));
		await session.settled();
		await session.afterRun(run([ask, message("user", text(RESUME))]));
		await session.settled();
		expect(asked).toHaveLength(1);
		expect(session.current()?.planner).toBe("model");
		await session.afterRun(
			run([message("user", text("Fix the parser instead"))]),
		);
		await session.settled();
		expect(asked).toHaveLength(2);
	});

	test("the revision names the chat position, never a message id", () => {
		const one = deriveTurn("s", run([message("user", text("One"))]));
		const again = deriveTurn("s", run([message("user", text("One"))]));
		expect(one?.revision).toBe(fnv1a32("s:1"));
		expect(again?.revision).toBe(one?.revision);
		expect(
			deriveTurn("t", run([message("user", text("One"))]))?.revision,
		).not.toBe(one?.revision);
		expect(
			deriveTurn(
				"s",
				run([message("user", text("One")), message("user", text("Two"))]),
			)?.revision,
		).toBe(fnv1a32("s:2"));
	});

	test("deriveTurnFromTranscript extracts turn facts, tools, edited paths, push state and modelInfo without a runId", () => {
		const user = message("user", text("Fix the retry logic"), {
			runId: "run_from_meta",
		});
		const assistant = {
			role: "assistant" as const,
			content: [
				{ type: "text", text: "Updated retry.ts." },
				{
					type: "tool-call",
					toolCallId: "tc1",
					toolName: "editor",
					input: { path: "src/retry.ts" },
				},
				{
					type: "tool-call",
					toolCallId: "tc2",
					toolName: "run_commands",
					input: { command: "git push origin main" },
				},
			],
			modelInfo: { provider: "anthropic", id: "claude-sonnet-4-5" },
		};
		const toolResult = {
			role: "tool" as const,
			content: [
				{
					type: "tool-result",
					toolCallId: "tc1",
					toolName: "editor",
					output: "ok",
				},
				{
					type: "tool-result",
					toolCallId: "tc2",
					toolName: "run_commands",
					output: { error: "permission denied" },
					isError: true,
				},
			],
		};
		const turn = deriveTurnFromTranscript(
			"sess_tx",
			[user, assistant, toolResult],
			"failed",
		);
		expect(turn).toMatchObject({
			runId: "run_from_meta",
			userMessageId: user.id,
			runCount: 1,
			turnKey: "sess_tx:1",
			revision: fnv1a32("sess_tx:1"),
			facts: { status: "failed", filesEdited: 1, toolErrored: true },
			pushed: true,
			chat: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
		});
		expect(turn?.context.request).toBe("Fix the retry logic");
		expect(turn?.context.reply).toBe("Updated retry.ts.");
		expect(turn?.context.editedPaths).toEqual(["src/retry.ts"]);
		expect(turn?.context.tools).toEqual([
			{ name: "editor", failed: false },
			{ name: "run_commands", failed: true, error: "permission denied" },
		]);
		expect(
			deriveTurnFromTranscript("sess_tx", [
				{ role: "assistant", content: "hi" },
			]),
		).toBeNull();
	});
});

function textOfParts(item: AgentMessage): string {
	return item.content
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n");
}
