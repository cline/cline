import { describe, expect, it } from "vitest";
import {
	ACTION_FOLLOW_THROUGH_NUDGE,
	createActionFollowThroughGuard,
	looksLikeUnfulfilledAction,
} from "./action-follow-through-guard";

describe("looksLikeUnfulfilledAction", () => {
	// Cases that SHOULD fire (real stall-shaped turns).
	it.each([
		[
			"narrate-open",
			"Built successfully now:\n\nNow I’m opening a fresh Extension Development Host window with that built local extension.",
		],
		[
			"plan-block",
			"Plan:\n1. Check what fields the onboarding UI displays.\n2. Update the backend payload shape.\n3. Explain what to change.",
		],
		["ill-update-now", "I'll update the PR body now to remove the stale refs."],
		["next-ill-run", "Next, I'll run the tests to confirm."],
		["let-me-check", "Let me check the config file for the flag."],
		// Present-progressive / imperative narration (previously missed).
		["gerund-checking", "Checking the config now."],
		["gerund-running", "Running the tests next."],
		["proceeding-to", "Proceeding to update the file."],
		["next-thing-is-to", "The next thing is to run the tests."],
		["i-need-to", "I need to inspect the logs."],
		[
			"mid-sentence-narration",
			"The build succeeded. Updating the changelog now.",
		],
	])("fires on %s", (_label, text) => {
		expect(looksLikeUnfulfilledAction(text)).toBe(true);
	});

	// Cases that should NOT fire (answers / recommendations / questions / done).
	it.each([
		["question", "Should I refactor this into a helper?"],
		[
			"recommendation",
			"You could extract the handler and add a test for it.",
		],
		["past-tense", "I've updated the file and verified the build."],
		[
			"explanation",
			"Here's how the parser works: it tokenizes the input, then builds an AST.",
		],
		["asks-permission", "Would you like me to apply this change?"],
		["vague-no-verb", "Let me take care of that."],
		["empty", "   "],
		[
			"user-instruction",
			"You can run `npm test` to verify the change works.",
		],
	])("does not fire on %s", (_label, text) => {
		expect(looksLikeUnfulfilledAction(text)).toBe(false);
	});
});

describe("createActionFollowThroughGuard", () => {
	it("returns the escape-hatch nudge for an unfulfilled action", () => {
		const guard = createActionFollowThroughGuard();
		expect(guard({ assistantText: "I'll run the tests now." })).toBe(
			ACTION_FOLLOW_THROUGH_NUDGE,
		);
	});

	it("returns undefined for a normal answer", () => {
		const guard = createActionFollowThroughGuard();
		expect(
			guard({ assistantText: "The function returns the parsed config." }),
		).toBeUndefined();
	});
});
