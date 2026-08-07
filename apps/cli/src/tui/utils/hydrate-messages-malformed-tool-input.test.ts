import type { Message } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { hydrateSessionMessages } from "./hydrate-messages";

describe("hydrateSessionMessages malformed tool input regression", () => {
	it("keeps a persisted run_commands call resumable when command is null", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-null-command",
						name: "run_commands",
						input: { command: null },
					},
				],
			},
		] as unknown as Message[];

		expect(() => hydrateSessionMessages(messages)).not.toThrow();

		const hydrated = hydrateSessionMessages(messages);
		expect(hydrated).toHaveLength(1);
		expect(hydrated[0]).toMatchObject({
			kind: "tool_call",
			toolName: "run_commands",
			inputSummary: "",
			rawInput: { command: null },
			streaming: false,
		});
	});
});