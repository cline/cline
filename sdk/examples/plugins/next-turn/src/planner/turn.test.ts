import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	Agent,
	CommandExitError,
	countUserRunMessages as coreCount,
	getUserRunSpan as coreSpan,
	createApplyPatchExecutor,
	createDefaultTools,
	createEditorExecutor,
} from "@cline/core";
import type {
	AgentMessage,
	MessageWithMetadata,
	ToolResultContent,
} from "@cline/shared";
import { TURN_TEXT_LIMIT } from "../config";
import {
	editingModel,
	editorTool,
	type Model,
	message,
	runResult,
	useTempDirs,
} from "../test-support";
import { fnv1a32 } from "./candidates";
import {
	countUserRunMessages,
	deriveTurn,
	deriveTurnFromTranscript,
	editedPaths,
	getUserRunSpan,
	lastPersonMessage,
	type MessageLike,
} from "./turn";

const tempDir = useTempDirs("next-turn-turn-");

/** The turn, held to the acceptance rule: its run count is core's count of the same transcript. */
function turnOf(messages: AgentMessage[], sessionId = "s") {
	const turn = deriveTurn(sessionId, runResult(messages));
	expect(turn?.runCount).toBe(coreCount(messages));
	return turn;
}

/** Makes `calls` together on its first request, then answers in text. */
function callingModel(
	calls: ReadonlyArray<readonly [toolName: string, input: unknown]>,
): Model {
	let requests = 0;
	return {
		async *stream() {
			requests += 1;
			if (requests === 1) {
				for (const [index, [toolName, input]] of calls.entries())
					yield {
						type: "tool-call-delta",
						index,
						toolCallId: `c${index}`,
						toolName,
						input,
					};
				yield { type: "finish", reason: "tool-calls" };
			} else {
				yield { type: "text-delta", text: "Done." };
				yield { type: "finish", reason: "stop" };
			}
		},
	};
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

describe("the turn's identity is core's run count", () => {
	test("a compaction summary counts the runs it folded (span 3)", () => {
		const summary = message(
			"user",
			"Context summary:\n\nThe person asked for three fixes.",
			{
				metadata: {
					kind: "compaction_summary",
					displayRole: "system",
					userRunSpan: 3,
				},
			},
		);
		const prompt = message("user", "Now add the tests");
		const turn = turnOf([
			summary,
			message("assistant", "Fixed."),
			prompt,
			message("assistant", "Added."),
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
		const scripted = editingModel("src/flaky.ts");
		let reminded = false;
		const agent = new Agent({
			model: scripted.model,
			tools: [editorTool],
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
		const ask = message("user", "Migrate the config");
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
			message("user", RESUME),
			message("user", ACT_APPROVAL),
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
		const ask = message("user", "Fix it");
		const marked = message("user", HOOK_BLOCK, {
			metadata: { userRunSpan: 0, displayRole: "system" },
		});
		expect(turnOf([ask, marked])).toMatchObject({
			runCount: 1,
			userMessageId: ask.id,
			context: { request: "Fix it" },
		});
		const unmarked = message("user", HOOK_BLOCK);
		const bare = message("user", "<hook_context>injected</hook_context>");
		expect(turnOf([ask, unmarked, bare])).toMatchObject({
			runCount: 3,
			userMessageId: ask.id,
			context: { request: "Fix it" },
		});
	});

	test("an image-only message is the person's, with an empty request", () => {
		const image = message("user", [IMAGE]);
		const messages = [
			message("user", "Match this mock"),
			message("assistant", "Which one?"),
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

	test("the revision names the chat position, never a message id", () => {
		const one = deriveTurn("s", runResult([message("user", "One")]));
		const again = deriveTurn("s", runResult([message("user", "One")]));
		expect(one?.revision).toBe(fnv1a32("s:1"));
		expect(again?.revision).toBe(one?.revision);
		expect(
			deriveTurn("t", runResult([message("user", "One")]))?.revision,
		).not.toBe(one?.revision);
		expect(
			deriveTurn(
				"s",
				runResult([message("user", "One"), message("user", "Two")]),
			)?.revision,
		).toBe(fnv1a32("s:2"));
	});

	test("deriveTurnFromTranscript extracts turn facts, tools, edited paths, push state and modelInfo without a runId", () => {
		const user = message("user", "Fix the retry logic", {
			metadata: { runId: "run_from_meta" },
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
			pushed: false,
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

	test("deriveTurnFromTranscript reads the provider blocks the hub's session.messages returns, with the same success filtering", () => {
		const operation = (fields: Record<string, unknown>) =>
			JSON.stringify({ result: "", ...fields });
		const stored: MessageWithMetadata[] = [
			{ id: "u1", role: "user", content: "Fix the retry and push" },
			{
				id: "a1",
				role: "assistant",
				content: [
					{ type: "text", text: "Fixed the retry and pushed." },
					{
						type: "tool_use",
						id: "written",
						name: "editor",
						input: { path: "src/retry.ts", old_text: "a", new_text: "b" },
					},
					{
						type: "tool_use",
						id: "not_found",
						name: "editor",
						input: { path: "src/client.ts", old_text: "a", new_text: "b" },
					},
					{
						type: "tool_use",
						id: "denied",
						name: "editor",
						input: { path: "src/config.ts", old_text: "a", new_text: "b" },
					},
					{
						type: "tool_use",
						id: "push",
						name: "run_commands",
						input: { commands: ["npm test", "git push"] },
					},
				],
				modelInfo: { provider: "anthropic", id: "claude-sonnet-4-5" },
			},
			{
				id: "r1",
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "written",
						name: "editor",
						content: operation({ query: "edit:src/retry.ts", success: true }),
					},
					{
						type: "tool_result",
						tool_use_id: "not_found",
						name: "editor",
						content: operation({
							query: "edit:src/client.ts",
							error: "old_text was not found in src/client.ts",
							success: false,
						}),
					},
					{
						type: "tool_result",
						tool_use_id: "denied",
						name: "editor",
						content: JSON.stringify({
							error: "The user denied this operation.",
						}),
						is_error: true,
					},
					{
						type: "tool_result",
						tool_use_id: "push",
						name: "run_commands",
						// Core stores a list of results as the list itself, not its JSON.
						content: [
							{ query: "npm test", result: "1 failing", success: false },
							{ query: "git push", result: "", success: true },
						] as unknown as ToolResultContent["content"],
					},
				],
			},
		];
		const turn = deriveTurnFromTranscript("sess_tx", stored, "completed");
		expect(turn?.runCount).toBe(coreCount(stored));
		expect(turn).toMatchObject({
			runCount: 1,
			facts: { filesEdited: 1, toolErrored: true },
			pushed: true,
			chat: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
			context: {
				request: "Fix the retry and push",
				reply: "Fixed the retry and pushed.",
				editedPaths: ["src/retry.ts"],
			},
		});
		expect(turn?.context.tools).toEqual([
			{ name: "editor", failed: false },
			{ name: "editor", failed: false },
			{
				name: "editor",
				failed: true,
				error: "The user denied this operation.",
			},
			{ name: "run_commands", failed: false },
		]);
	});

	test("a push is a git push or a PR opened, merged or readied, read from the tool call's input", () => {
		const pushedBy = (input: unknown) =>
			deriveTurnFromTranscript("sess_push", [
				message("user", "Ship it"),
				{
					role: "assistant",
					content: [
						{
							type: "tool-call",
							toolCallId: "tc",
							toolName: "run_commands",
							input,
						},
					],
				},
			])?.pushed;
		expect(pushedBy("git push -u origin HEAD")).toBe(true);
		expect(pushedBy({ commands: ["gh pr create --fill"] })).toBe(true);
		expect(pushedBy("git pushd")).toBe(false);
		expect(pushedBy(undefined)).toBe(false);
	});
});

describe("the turn, from the run result", () => {
	const earlier = [
		message("user", "First request"),
		message("assistant", "ok"),
	];

	test("facts and context come only from after the person's last message", () => {
		const user = message("user", "Fix the failing test in users.test.ts");
		const messages = [
			...earlier,
			message("assistant", [
				{
					type: "tool-call",
					toolCallId: "old",
					toolName: "editor",
					input: { path: "old.ts" },
				},
			]),
			user,
			message("user", "<hook_context>injected</hook_context>", {
				metadata: { userRunSpan: 0, displayRole: "system" },
			}),
			message(
				"assistant",
				[
					{
						type: "tool-call",
						toolCallId: "c1",
						toolName: "editor",
						input: { path: "src/users.ts" },
					},
					{
						type: "tool-call",
						toolCallId: "c2",
						toolName: "apply_patch",
						input: { input: "*** Update File: a.ts\n*** Add File: b.ts\n" },
					},
					{
						type: "tool-call",
						toolCallId: "c3",
						toolName: "run_commands",
						input: { command: "git push -u origin feature" },
					},
				],
				{ modelInfo: { id: "claude-sonnet-5-5", provider: "anthropic" } },
			),
			message("tool", [
				{
					type: "tool-result",
					toolCallId: "c1",
					toolName: "editor",
					output: "ok",
				},
				{
					type: "tool-result",
					toolCallId: "c3",
					toolName: "run_commands",
					output: { error: "token=abcdefghijklmnopqr rejected" },
					isError: true,
				},
			]),
		];
		const turn = deriveTurn(
			"s1",
			runResult(messages, { runId: "run_si9HsPkJ" }),
		);
		expect(turn).toMatchObject({
			runId: "run_si9HsPkJ",
			userMessageId: user.id,
			runCount: 2,
			turnKey: "s1:2",
			facts: { status: "completed", filesEdited: 3, toolErrored: true },
			pushed: false,
			chat: { providerId: "anthropic", modelId: "claude-sonnet-5-5" },
		});
		expect(turn?.context.request).toBe("Fix the failing test in users.test.ts");
		expect(turn?.context.editedPaths).toEqual(["src/users.ts", "a.ts", "b.ts"]);
		expect(turn?.context.tools).toEqual([
			{ name: "editor", failed: false },
			{
				name: "run_commands",
				failed: true,
				error: "token=[redacted] rejected",
			},
		]);
	});

	test("an edit or a push whose call was denied or failed changes nothing", () => {
		const turn = deriveTurn(
			"s",
			runResult([
				message("user", "Fix the client"),
				message("assistant", [
					{
						type: "tool-call",
						toolCallId: "denied",
						toolName: "editor",
						input: { path: "src/client.ts" },
					},
					{
						type: "tool-call",
						toolCallId: "written",
						toolName: "editor",
						input: { path: "src/retry.ts" },
					},
					{
						type: "tool-call",
						toolCallId: "push",
						toolName: "run_commands",
						input: { command: "git push" },
					},
				]),
				message("tool", [
					{
						type: "tool-result",
						toolCallId: "denied",
						toolName: "editor",
						output: { error: "The user denied this operation." },
						isError: true,
					},
					{
						type: "tool-result",
						toolCallId: "written",
						toolName: "editor",
						output: "ok",
					},
					{
						type: "tool-result",
						toolCallId: "push",
						toolName: "run_commands",
						output: { error: "rejected" },
						isError: true,
					},
				]),
			]),
		);
		expect(turn).toMatchObject({
			facts: { filesEdited: 1, toolErrored: true },
			pushed: false,
		});
		expect(turn?.context.editedPaths).toEqual(["src/retry.ts"]);
	});

	test("an edit whose text was not found and a rejected push, as Cline's own tools report them, change nothing", async () => {
		const editor = createDefaultTools({
			cwd: "/repo",
			executors: {
				editor: async (input) => {
					if (input.path.endsWith("retry.ts"))
						throw new Error("old_text was not found in src/retry.ts");
					return "edited";
				},
				bash: async (command) => {
					const line = String(command);
					if (line.startsWith("npm test"))
						throw new CommandExitError(1, "1 failing");
					if (line.startsWith("git push"))
						throw new CommandExitError(1, "! [rejected] main -> main");
					return "";
				},
			},
		});
		const patch = createDefaultTools({
			cwd: "/repo",
			enableApplyPatch: true,
			executors: {
				applyPatch: async () => {
					throw new Error("context lines did not match src/parser.ts");
				},
			},
		});
		const failedEdits = await new Agent({
			model: callingModel([
				[
					"editor",
					{ path: "/repo/src/retry.ts", old_text: "a", new_text: "b" },
				],
				[
					"editor",
					{ path: "/repo/src/client.ts", old_text: "a", new_text: "b" },
				],
				["run_commands", { commands: ["npm test", "git push"] }],
			]),
			tools: editor,
		}).run("Fix the retry and push");
		const results = failedEdits.messages.flatMap((item) =>
			item.content.filter((part) => part.type === "tool-result"),
		);
		expect(results).toHaveLength(3);
		expect(results.some((part) => part.isError)).toBe(false);
		const turn = deriveTurn("s", failedEdits);
		expect(turn).toMatchObject({
			facts: { filesEdited: 1, toolErrored: false },
			pushed: false,
		});
		expect(turn?.context.editedPaths).toEqual(["/repo/src/client.ts"]);

		const pushedPastFailingTests = await new Agent({
			model: callingModel([
				["run_commands", { commands: ["npm test", "gh pr create --fill"] }],
			]),
			tools: editor,
		}).run("Open the PR");
		expect(deriveTurn("s", pushedPastFailingTests)?.pushed).toBe(true);

		const failedPatch = await new Agent({
			model: callingModel([
				[
					"apply_patch",
					{ input: "*** Begin Patch\n*** Update File: src/parser.ts\n" },
				],
			]),
			tools: patch,
		}).run("Fix the parser");
		expect(deriveTurn("s", failedPatch)?.facts.filesEdited).toBe(0);
	});

	test("a patch core stopped partway through writing counts its files; one it rejected before writing counts none", async () => {
		const cwd = tempDir();
		writeFileSync(
			join(cwd, "blocker"),
			"a file where the patch needs a folder",
		);
		writeFileSync(join(cwd, "client.ts"), "export const retries = 1;\n");
		const tools = createDefaultTools({
			cwd,
			enableApplyPatch: true,
			executors: { applyPatch: createApplyPatchExecutor() },
		});
		const patchRun = (patch: string) =>
			new Agent({
				model: callingModel([["apply_patch", { input: patch }]]),
				tools,
			}).run("Add the retry");

		const partlyWritten = await patchRun(
			[
				"*** Begin Patch",
				"*** Add File: retry.ts",
				"+export const retry = true;",
				"*** Add File: blocker/policy.ts",
				"+export const policy = {};",
				"*** End Patch",
			].join("\n"),
		);
		expect(existsSync(join(cwd, "retry.ts"))).toBe(true);
		expect(toolOutputs(partlyWritten.messages)).toEqual([
			expect.objectContaining({
				success: false,
				error: expect.stringMatching(/^apply_patch failed: E[A-Z]+: /),
			}),
		]);
		expect(deriveTurn("s", partlyWritten)?.context.editedPaths).toEqual([
			"retry.ts",
			"blocker/policy.ts",
		]);

		const movedOutside = await patchRun(
			[
				"*** Begin Patch",
				"*** Add File: backoff.ts",
				"+export const backoff = 2;",
				"*** Update File: client.ts",
				"*** Move to: ../outside/client.ts",
				"@@",
				"-export const retries = 1;",
				"+export const retries = 3;",
				"*** End Patch",
			].join("\n"),
		);
		expect(existsSync(join(cwd, "backoff.ts"))).toBe(true);
		expect(toolOutputs(movedOutside.messages)).toEqual([
			expect.objectContaining({
				success: false,
				error:
					"apply_patch failed: Path must stay within cwd: ../outside/client.ts",
			}),
		]);
		expect(deriveTurn("s", movedOutside)?.context.editedPaths).toEqual([
			"backoff.ts",
			"client.ts",
		]);

		const unapplied = await patchRun(
			[
				"*** Begin Patch",
				"*** Add File: notes.ts",
				"+export const notes = [];",
				"*** Update File: client.ts",
				"@@ export function retry",
				"-\treturn fetchOnce();",
				"+\treturn fetchWithRetry();",
				"*** End Patch",
			].join("\n"),
		);
		expect(existsSync(join(cwd, "notes.ts"))).toBe(false);
		expect(toolOutputs(unapplied.messages)).toEqual([
			expect.objectContaining({ success: false }),
		]);
		expect(deriveTurn("s", unapplied)?.facts.filesEdited).toBe(0);

		const deletesOutside = await patchRun(
			[
				"*** Begin Patch",
				"*** Add File: notes.ts",
				"+export const notes = [];",
				"*** Delete File: ../outside/client.ts",
				"*** End Patch",
			].join("\n"),
		);
		expect(existsSync(join(cwd, "notes.ts"))).toBe(false);
		expect(toolOutputs(deletesOutside.messages)).toEqual([
			expect.objectContaining({
				success: false,
				error:
					"apply_patch failed: Path must stay within cwd: ../outside/client.ts",
			}),
		]);
		expect(deriveTurn("s", deletesOutside)?.facts.filesEdited).toBe(0);
	});

	test("an edit or a patch that ran out of time counts its files, since core lets the write finish", async () => {
		const cwd = tempDir();
		let releaseWrites = () => {};
		const writesHeld = new Promise<void>((resolve) => {
			releaseWrites = resolve;
		});
		const heldWrites: Promise<string>[] = [];
		const held =
			<Args extends unknown[]>(write: (...args: Args) => Promise<string>) =>
			(...args: Args) => {
				const pending = writesHeld.then(() => write(...args));
				heldWrites.push(pending);
				return pending;
			};
		const timedOutEdit = await new Agent({
			model: callingModel([
				["editor", { path: "retry.ts", new_text: "export const retry = 3;\n" }],
			]),
			tools: createDefaultTools({
				cwd,
				editorTimeoutMs: 1,
				executors: { editor: held(createEditorExecutor()) },
			}),
		}).run("Add the retry");
		const timedOutPatch = await new Agent({
			model: callingModel([
				[
					"apply_patch",
					{
						input: [
							"*** Begin Patch",
							"*** Add File: backoff.ts",
							"+export const backoff = 2;",
							"*** End Patch",
						].join("\n"),
					},
				],
			]),
			tools: createDefaultTools({
				cwd,
				enableApplyPatch: true,
				applyPatchTimeoutMs: 1,
				executors: { applyPatch: held(createApplyPatchExecutor()) },
			}),
		}).run("Add the backoff");
		expect(
			toolOutputs([...timedOutEdit.messages, ...timedOutPatch.messages]),
		).toEqual([
			expect.objectContaining({
				success: false,
				error: "Editor operation failed: Editor operation timed out after 1ms",
			}),
			expect.objectContaining({
				success: false,
				error: "apply_patch failed: apply_patch timed out after 1ms",
			}),
		]);

		releaseWrites();
		await Promise.all(heldWrites);
		expect(existsSync(join(cwd, "retry.ts"))).toBe(true);
		expect(existsSync(join(cwd, "backoff.ts"))).toBe(true);
		expect(deriveTurn("s", timedOutEdit)?.context.editedPaths).toEqual([
			"retry.ts",
		]);
		expect(deriveTurn("s", timedOutPatch)?.context.editedPaths).toEqual([
			"backoff.ts",
		]);
	});

	test("an aborted run is a stopped turn, a failed run a failed one; no message is no turn", () => {
		const user = message("user", "Go");
		expect(
			deriveTurn("s", runResult([user], { status: "aborted" }))?.facts.status,
		).toBe("cancelled");
		expect(
			deriveTurn("s", runResult([user], { status: "failed" }))?.facts.status,
		).toBe("failed");
		expect(deriveTurn("s", runResult([]))).toBeNull();
		expect(
			lastPersonMessage([user, message("user", "<hook_context>x")]),
		).toEqual({ id: user.id, text: "Go" });
		expect(editedPaths({ filePath: " x.ts " })).toEqual(["x.ts"]);
	});

	test("a secret across the text limit is redacted whole before the text is cut", () => {
		const secret = "sk-ant-0123456789abcdefghijklmnop";
		const request = `${"x".repeat(TURN_TEXT_LIMIT - 10)} ${secret}`;
		const turn = deriveTurn("s", runResult([message("user", request)]));
		expect(turn?.context.request).not.toContain("sk-ant");
		expect(turn?.context.request).not.toContain("0123");
		expect(turn?.context.request.length).toBeLessThanOrEqual(TURN_TEXT_LIMIT);
	});
});

function toolOutputs(messages: readonly AgentMessage[]): unknown[] {
	return messages.flatMap((item) =>
		item.content.flatMap((part) =>
			part.type === "tool-result" ? [part.output] : [],
		),
	);
}

function textOfParts(item: AgentMessage): string {
	return item.content
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n");
}
