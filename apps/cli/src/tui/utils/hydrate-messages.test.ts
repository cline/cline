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
			{ kind: "user_submitted", text: "lets do it" },
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
			{ kind: "assistant_text", text: "On it.", streaming: false },
		]);
	});
});
