import { describe, expect, it } from "vitest";
import { classifyBumpText, classifyFinalTurnText } from "./stall-signals";

// Expected labels are what the offline Python detector returns for the same text.
describe("stall signals", () => {
	it.each([
		["continue", "nudge"],
		["ok continue", "nudge"],
		["продолжай", "nudge"],
		["继续", "nudge"],
		["can you pick up where you left off?", "nudge"],
		["are you stuck?", "probe"],
		["did it finish?", "probe"],
		["status?", "probe"],
		["...", "probe"],
		["还在吗", "probe"],
		["hello", "greeting"],
		[
			"I'm stuck on page 1 of the docs, can you help me with the layout?",
			"none",
		],
		["go ahead and refactor the payment module to use the new client", "none"],
		["fix the failing test in auth.ts", "none"],
	])("bump: %s → %s", (text, kind) => {
		expect(classifyBumpText(text)).toBe(kind);
	});

	it.each([
		["", "empty_turn"],
		["API error: 529 overloaded_error", "api_error"],
		["Here is the change:\n```ts\nconst x = 1", "truncated_text"],
		["I updated the config and the", "truncated_text"],
		["Now let me run the tests:", "intent_without_action"],
		[
			"Summary of changes.\n\nLet me run the linter to verify:",
			"intent_without_action",
		],
		["I'll ping you when the build finishes.", "async_promise"],
		["Should I proceed with the migration?", "none"],
		["Let me know if you want me to continue.", "none"],
		["Changes:\n- added the toggle\n- removed the old flag", "none"],
		["The fix is in place 🎉", "none"],
	])("final text: %j → %s", (text, signature) => {
		expect(classifyFinalTurnText(text)).toBe(signature);
	});
});
