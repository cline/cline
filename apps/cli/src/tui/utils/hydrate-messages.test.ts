import type { Message } from "@cline/shared";
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
});
