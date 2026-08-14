import { readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Message, MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { ACT_MODE_CONTINUATION_PROMPT } from "../../runtime/interactive/mode";
import { hydrateSessionMessages } from "./hydrate-messages";

describe("hydrateSessionMessages", () => {
	it("renders regular user messages", () => {
		const messages = [
			{
				role: "user",
				content: '<user_input mode="plan">lets do it</user_input>',
			},
		] as Message[];

		expect(hydrateSessionMessages(messages)).toEqual([
			{ kind: "user_submitted", text: "lets do it", mode: "plan" },
		]);
	});

	it("hides the synthetic act-mode continuation prompt", () => {
		const messages = [
			{
				role: "user",
				content: `<user_input mode="act">${ACT_MODE_CONTINUATION_PROMPT}</user_input>`,
			},
			{
				role: "user",
				content: [
					{
						type: "text",
						text: `<user_input mode="act">${ACT_MODE_CONTINUATION_PROMPT}</user_input>`,
					},
				],
			},
			{
				role: "assistant",
				content: "On it.",
			},
		] as Message[];

		expect(hydrateSessionMessages(messages)).toEqual([
			{ kind: "assistant_text", text: "On it.", streaming: false, mode: "act" },
		]);
	});

	it("stamps entries with the mode of the user message that produced them", () => {
		const messages = [
			{
				role: "user",
				content: '<user_input mode="plan">plan this out</user_input>',
			},
			{ role: "assistant", content: "Here is the plan." },
			{
				role: "user",
				content: '<user_input mode="act">do it</user_input>',
			},
			{ role: "assistant", content: "Doing it." },
		] as Message[];

		expect(hydrateSessionMessages(messages)).toEqual([
			{ kind: "user_submitted", text: "plan this out", mode: "plan" },
			{
				kind: "assistant_text",
				text: "Here is the plan.",
				streaming: false,
				mode: "plan",
			},
			{ kind: "user_submitted", text: "do it", mode: "act" },
			{
				kind: "assistant_text",
				text: "Doing it.",
				streaming: false,
				mode: "act",
			},
		]);
	});

	it("switches to act mode after a switch_to_act_mode tool call", () => {
		const messages = [
			{
				role: "user",
				content: '<user_input mode="plan">plan then build</user_input>',
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Plan looks good, switching." },
					{
						type: "tool_use",
						id: "tool-1",
						name: "switch_to_act_mode",
						input: {},
					},
					{ type: "text", text: "Building now." },
				],
			},
		] as Message[];

		expect(hydrateSessionMessages(messages)).toEqual([
			{ kind: "user_submitted", text: "plan then build", mode: "plan" },
			{
				kind: "assistant_text",
				text: "Plan looks good, switching.",
				streaming: false,
				mode: "plan",
			},
			{
				kind: "tool_call",
				toolCallId: "tool-1",
				toolName: "switch_to_act_mode",
				inputSummary: expect.any(String),
				rawInput: {},
				streaming: false,
				mode: "plan",
			},
			{
				kind: "assistant_text",
				text: "Building now.",
				streaming: false,
				mode: "act",
			},
		]);
	});

	it("strips mode switch notices from displayed user text", () => {
		const messages = [
			{
				role: "user",
				content:
					'<user_input mode="plan"><mode_notice>The user switched from act mode to plan mode before sending this message.</mode_notice>\nare you okay?</user_input>',
			},
		] as Message[];

		expect(hydrateSessionMessages(messages)).toEqual([
			{ kind: "user_submitted", text: "are you okay?", mode: "plan" },
		]);
	});

	// Regression test for https://github.com/cline/cline/issues/13036:
	// persisted sessions with malformed tool inputs must stay resumable.
	it("hydrates tool calls with malformed inputs without throwing", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-1",
						name: "run_commands",
						input: { command: null },
					},
				],
			},
		] as Message[];

		expect(hydrateSessionMessages(messages)).toEqual([
			{
				kind: "tool_call",
				toolCallId: "tool-1",
				toolName: "run_commands",
				inputSummary: "",
				rawInput: { command: null },
				streaming: false,
				mode: undefined,
			},
		]);
	});

	it("leaves mode undefined for transcripts without user_input wrappers", () => {
		const messages = [
			{ role: "user", content: "plain old message" },
			{ role: "assistant", content: "reply" },
		] as Message[];

		expect(hydrateSessionMessages(messages)).toEqual([
			{ kind: "user_submitted", text: "plain old message", mode: undefined },
			{
				kind: "assistant_text",
				text: "reply",
				streaming: false,
				mode: undefined,
			},
		]);
	});

	it("materializes generated images from resumed assistant history", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{
						type: "image",
						data: Buffer.from("history-image").toString("base64"),
						mediaType: "image/webp",
					},
				],
			},
		] as Message[];

		const [entry] = hydrateSessionMessages(messages);
		expect(entry).toMatchObject({
			kind: "assistant_media",
			modality: "image",
			mediaType: "image/webp",
			byteLength: 13,
			mode: undefined,
		});
		if (entry?.kind !== "assistant_media" || !entry.location) {
			throw new Error("Expected a materialized assistant image");
		}
		try {
			expect(readFileSync(entry.location, "utf8")).toBe("history-image");
		} finally {
			rmSync(dirname(entry.location), { recursive: true, force: true });
		}
	});

	it("hydrates provider model tools through the ordinary tool card path", () => {
		const messages: MessageWithMetadata[] = [
			{
				id: "assistant-search",
				role: "assistant",
				content: "Bun 1.3.14 is the latest stable release.",
				metadata: {
					modelToolActivities: [
						{
							toolCallId: "search-1",
							toolName: "web_search",
							execution: "provider",
							input: { query: "latest Bun stable release" },
							output: { sources: ["https://bun.sh/blog/bun-v1.3.14"] },
						},
					],
				},
			},
		];

		expect(hydrateSessionMessages(messages)).toEqual([
			{
				kind: "tool_call",
				toolCallId: "search-1",
				toolName: "web_search",
				inputSummary: expect.any(String),
				rawInput: { query: "latest Bun stable release" },
				streaming: false,
				mode: undefined,
				result: {
					outputSummary: '{"sources":["https://bun.sh/blog/bun-v1.3.14"]}',
					rawOutput: '{"sources":["https://bun.sh/blog/bun-v1.3.14"]}',
					error: undefined,
				},
			},
			{
				kind: "assistant_text",
				text: "Bun 1.3.14 is the latest stable release.",
				streaming: false,
				mode: undefined,
			},
		]);
	});

	it("hydrates structured native search output and mirrors live error payloads", () => {
		const nativeResult = {
			type: "web_search_result",
			url: "https://bun.sh/blog/bun-v1.3.14",
			title: "Bun v1.3.14",
			pageAge: "2026-08-12",
			encryptedContent: "encrypted",
		};
		const messages: MessageWithMetadata[] = [
			{
				role: "assistant",
				content: "Search failed.",
				metadata: {
					modelToolActivities: [
						{
							toolCallId: "search-native",
							toolName: "web_search",
							execution: "provider",
							input: { query: "latest Bun" },
							output: [nativeResult],
							isError: true,
						},
					],
				},
			},
		];

		const [toolEntry] = hydrateSessionMessages(messages);
		expect(toolEntry).toMatchObject({
			kind: "tool_call",
			toolCallId: "search-native",
			result: {
				outputSummary: "",
				rawOutput: undefined,
				error: JSON.stringify([nativeResult]),
			},
		});
	});
});
