import { describe, expect, it } from "vitest";
import {
	messageCopyText,
	messageDisplayText,
	visibleTranscriptMessages,
} from "../screens/chat/message-text";
import { createSessionState, reduceSession, selectViewModel } from "./reducer";
import { parseSessionMessagesReply } from "./schemas";

describe("runtime history visibility metadata", () => {
	it("keeps attachment-bearing continuation turns visible", () => {
		const parsed = parseSessionMessagesReply({
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "[TASK RESUMPTION] Please continue where you left off.",
						},
						{ type: "file", path: "note.txt", content: "c2FtcGxl" },
					],
				},
			],
		});
		if (parsed.status !== "ok") throw new Error("Fixture must parse");
		const state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: parsed.messages,
		});
		expect(selectViewModel(state).messages[0]?.hidden).toBeUndefined();
		expect(
			selectViewModel(state).messages[0]?.blocks.some(
				(block) => block.kind === "media",
			),
		).toBe(true);
	});
	it("hides exact raw runtime hook blocks after metadata loss but preserves user-wrapped and fenced XML", () => {
		const hook =
			'<hook_context source="RunStart">\nRepository instructions for the agent\n</hook_context>';
		const parsed = parseSessionMessagesReply({
			messages: [
				{ role: "user", content: hook },
				{
					role: "user",
					content: `<user_input mode="act">${hook}</user_input>`,
				},
				{ role: "user", content: `\`\`\`xml\n${hook}\n\`\`\`` },
				{ role: "assistant", content: hook },
			],
		});
		if (parsed.status !== "ok") throw new Error("Fixture must parse");
		const state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: parsed.messages,
		});
		expect(
			selectViewModel(state).messages.map((item) => item.hidden === true),
		).toEqual([true, false, false, false]);
	});
	it("recognizes exact legacy SDK continuation prompts without hiding prose mentioning them", () => {
		const parsed = parseSessionMessagesReply({
			messages: [
				{
					role: "user",
					content:
						'<user_input mode="act">[TASK RESUMPTION] Please continue where you left off.</user_input>',
				},
				{
					role: "user",
					content:
						"The user approved switching to act mode. Continue with the approved plan now.",
				},
				{
					role: "user",
					content: "[TASK RESUMPTION] is an example in my document",
				},
				{
					role: "assistant",
					content: "[TASK RESUMPTION] Please continue where you left off.",
				},
				{
					role: "user",
					content:
						"<mode_notice>My authored XML example</mode_notice>[TASK RESUMPTION] Please continue where you left off.",
				},
				{
					role: "user",
					content:
						"<user_input>[TASK RESUMPTION] Please continue where you left off.</user_input>",
				},
			],
		});
		if (parsed.status !== "ok") throw new Error("Fixture must parse");
		const state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: parsed.messages,
		});
		expect(
			selectViewModel(state).messages.map((item) => item.hidden === true),
		).toEqual([true, true, false, false, false, false]);
	});
	it("does not reconcile away a visible optimistic prompt against matching internal context", () => {
		let state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: [],
		});
		state = reduceSession(state, {
			type: "user_input",
			text: "My pending request",
		});
		state = reduceSession(state, {
			type: "hydrated",
			messages: [
				{
					role: "user",
					content: "My pending request",
					metadata: { kind: "recovery_notice" },
				},
			],
		});
		expect(
			selectViewModel(state).messages.filter((item) => !item.hidden),
		).toMatchObject([
			{
				role: "user",
				pending: true,
				blocks: [{ kind: "text", text: "My pending request" }],
			},
		]);
		state = reduceSession(state, {
			type: "hydrated",
			messages: [
				{
					role: "user",
					content: "My pending request",
					metadata: { kind: "recovery_notice" },
				},
				{
					role: "user",
					content: '<user_input mode="act">My pending request</user_input>',
				},
			],
		});
		expect(
			selectViewModel(state).messages.filter((item) => !item.hidden),
		).toMatchObject([{ role: "user", origin: "hydrated" }]);
		expect(state.live).toHaveLength(0);
	});
	it("keeps compaction/recovery/status context out of chat while retaining ordinary turns and errors", () => {
		const payload = {
			messages: [
				{
					role: "user",
					content: "Compacted private context",
					metadata: { kind: "compaction_summary", displayRole: "system" },
				},
				{
					role: "user",
					content: "Runtime recovery instructions",
					metadata: { kind: "recovery_notice" },
				},
				{
					role: "assistant",
					content: "Internal progress detail",
					metadata: { displayRole: "status" },
				},
				{
					role: "user",
					content: '<user_input mode="act">My visible request</user_input>',
				},
				{ role: "assistant", content: "Visible answer" },
				{
					role: "assistant",
					content: "User-visible failure",
					metadata: { displayOnly: true, displayRole: "error" },
				},
			],
		};
		const parsed = parseSessionMessagesReply(payload);
		expect(parsed.status).toBe("ok");
		if (parsed.status !== "ok") throw new Error("Fixture must parse");
		const state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: parsed.messages,
		});
		const view = selectViewModel(state);
		expect(view.messages.map((item) => item.hidden === true)).toEqual([
			true,
			true,
			true,
			false,
			false,
			false,
		]);
		expect(view.messages.at(-1)?.displayRole).toBe("error");
		expect(state.hydrated[0]?.blocks).toEqual([
			{ kind: "text", text: "Compacted private context" },
		]);
		expect(payload.messages[0]?.content).toBe("Compacted private context");
	});
	it("does not infer hidden messages from text or arbitrary metadata", () => {
		const parsed = parseSessionMessagesReply({
			messages: [
				{
					role: "user",
					content: "[TASK RESUMPTION] is an example in my document",
					metadata: { kind: "user_note" },
				},
				{
					role: "assistant",
					content: "Context summary: an explanation",
					metadata: { kind: "compaction_summary" },
				},
				{
					role: "user",
					content: "<system_reminder>My XML example</system_reminder>",
				},
			],
		});
		if (parsed.status !== "ok") throw new Error("Fixture must parse");
		const state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: parsed.messages,
		});
		expect(selectViewModel(state).messages.every((item) => !item.hidden)).toBe(
			true,
		);
	});
});

it("hides metadata-marked runtime reminders from rows, copy and conversation search while preserving authored text", () => {
	const internal =
		"[SYSTEM] This run is not complete until you call one of these terminal completion tools: submit_and_exit. Continue working if requirements are not met. If the task is complete, call the appropriate terminal completion tool now.";
	const outputLimit =
		"Your previous response was cut off because it reached the model's output-token limit before finishing. Keep responses concise: take one small step at a time, avoid long explanations, and write large files or command output in smaller chunks across multiple tool calls.";
	const payload = {
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: internal }],
				metadata: { userRunSpan: 0 },
			},
			{
				role: "user",
				content:
					"[SYSTEM] You still have team obligations. Unfinished tasks: task1 (pending): inspect. Do NOT stop until all tasks are completed.",
				metadata: { userRunSpan: 0 },
			},
			{ role: "user", content: outputLimit, metadata: { userRunSpan: 0 } },
			{ role: "user", content: internal },
			{
				role: "user",
				content: `<user_input mode="act">${internal}</user_input>`,
				metadata: { userRunSpan: 0 },
			},
			{
				role: "user",
				content: "Visible mid-run steering",
				metadata: { userRunSpan: 0 },
			},
			{ role: "assistant", content: internal, metadata: { userRunSpan: 0 } },
			{
				role: "user",
				content:
					"```xml\n<system-reminder>authored example</system-reminder>\n```",
				metadata: { userRunSpan: 0 },
			},
		],
	};
	const parsed = parseSessionMessagesReply(payload);
	if (parsed.status !== "ok") throw new Error("Fixture must parse");
	const view = selectViewModel(
		reduceSession(createSessionState(), {
			type: "hydrated",
			messages: parsed.messages,
		}),
	);
	expect(view.messages.map((message) => message.hidden === true)).toEqual([
		true,
		true,
		true,
		false,
		false,
		false,
		false,
		false,
	]);
	expect(visibleTranscriptMessages(view.messages)).toHaveLength(5);
	for (const message of view.messages.slice(0, 3)) {
		expect(messageDisplayText(message)).toBe("");
		expect(messageCopyText(message)).toBe("");
	}
	expect(messageCopyText(view.messages[4]!)).toBe(internal);
	expect(messageCopyText(view.messages[7]!)).toContain(
		"<system-reminder>authored example</system-reminder>",
	);
});

it("does not mistake zero-span user steering, attachments, error notices or malformed metadata for runtime reminders", () => {
	const messages = [
		{
			role: "user" as const,
			content: "[SYSTEM] I wrote this prefix",
			metadata: { userRunSpan: "0" },
		},
		{
			role: "user" as const,
			content: [
				{ type: "text", text: "[SYSTEM] Describe my image" },
				{ type: "image", data: "aGVsbG8=", mediaType: "image/png" },
			],
			metadata: { userRunSpan: 0 },
		},
		{
			role: "assistant" as const,
			content: "[SYSTEM] Useful error",
			metadata: { userRunSpan: 0, displayRole: "error" },
		},
	];
	const parsed = parseSessionMessagesReply({ messages });
	if (parsed.status !== "ok") throw new Error("Fixture must parse");
	expect(parsed.invalidCount).toBe(0);
	const view = selectViewModel(
		reduceSession(createSessionState(), {
			type: "hydrated",
			messages: parsed.messages,
		}),
	);
	expect(visibleTranscriptMessages(view.messages)).toHaveLength(3);
	expect(view.messages.every((message) => !message.hidden)).toBe(true);
});
