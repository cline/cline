import { describe, expect, test } from "bun:test";
import {
	countUserRunMessages as coreCount,
	getUserRunSpan as coreSpan,
} from "@cline/core";
import {
	countUserRunMessages,
	getUserRunSpan,
	type MessageLike,
} from "./run-count";
import {
	ACT_APPROVAL,
	HOOK_BLOCK,
	IMAGE,
	MODE_NOTICE,
	RESUME,
} from "./user-messages.fixtures";

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
