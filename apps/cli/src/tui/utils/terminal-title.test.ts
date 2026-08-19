import { describe, expect, it } from "vitest";
import { deriveTerminalTitle } from "./terminal-title";

describe("deriveTerminalTitle", () => {
	it("uses the base title outside chat", () => {
		expect(
			deriveTerminalTitle({
				appView: "home",
				entries: [{ kind: "user_submitted", text: "hello" }],
			}),
		).toBe("Cline");
	});

	it("uses the latest submitted user message in chat", () => {
		expect(
			deriveTerminalTitle({
				appView: "chat",
				entries: [
					{ kind: "user_submitted", text: "first request" },
					{ kind: "assistant_text", text: "ok", streaming: false },
					{ kind: "user_submitted", text: "second request" },
				],
			}),
		).toBe("> second request");
	});

	it("falls back to the initial prompt before it is submitted", () => {
		expect(
			deriveTerminalTitle({
				appView: "chat",
				entries: [],
				initialPrompt: "start this task",
			}),
		).toBe("> start this task");
	});

	it("normalizes wrapped user input and control characters", () => {
		expect(
			deriveTerminalTitle({
				appView: "chat",
				entries: [
					{
						kind: "user_submitted",
						text: '<user_input mode="act">hello\x1b]0;bad\x07\nworld</user_input>',
					},
				],
			}),
		).toBe("> hello ]0;bad");
	});

	it("truncates long titles", () => {
		const title = deriveTerminalTitle({
			appView: "chat",
			entries: [{ kind: "user_submitted", text: "a".repeat(120) }],
		});

		expect(title).toHaveLength(80);
		expect(title.endsWith("...")).toBe(true);
	});
});
