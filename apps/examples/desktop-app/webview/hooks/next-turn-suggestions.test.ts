import { describe, expect, it } from "vitest";
import {
	acceptNextTurnSuggestions,
	currentNextTurnPrompt,
	cycleNextTurnSuggestions,
	EMPTY_NEXT_TURN_THREAD,
	markNewerNextTurnRun,
	readNextTurnSuggestions,
	visibleNextTurnSuggestions,
} from "./next-turn-suggestions";

const payload = {
	sessionId: "session-1",
	runId: "run-1",
	status: "completed",
	suggestions: [
		{ prompt: "Run the checks for the files the last turn changed." },
		{ prompt: "Review the changes from the last turn before going on." },
	],
};

describe("next-turn suggestions", () => {
	it("reads this empty thread's full suggestion set at the first prompt", () => {
		const state = readNextTurnSuggestions({
			sessionId: "session-1",
			draft: "",
			payload,
		});

		expect(state).toEqual({
			prompts: [
				"Run the checks for the files the last turn changed.",
				"Review the changes from the last turn before going on.",
			],
			index: 0,
		});
		expect(currentNextTurnPrompt(state ?? undefined)).toBe(
			"Run the checks for the files the last turn changed.",
		);
	});

	it("cycles forward and backward through only the current set", () => {
		const first = readNextTurnSuggestions({
			sessionId: "session-1",
			draft: "",
			payload,
		});
		if (!first) throw new Error("Expected suggestions");

		const second = cycleNextTurnSuggestions(first);
		const forwardWrapped = cycleNextTurnSuggestions(second);
		const backwardWrapped = cycleNextTurnSuggestions(first, "previous");
		const backToFirst = cycleNextTurnSuggestions(second, "previous");

		expect(currentNextTurnPrompt(second)).toBe(
			"Review the changes from the last turn before going on.",
		);
		expect(currentNextTurnPrompt(forwardWrapped)).toBe(
			"Run the checks for the files the last turn changed.",
		);
		expect(currentNextTurnPrompt(backwardWrapped)).toBe(
			"Review the changes from the last turn before going on.",
		);
		expect(currentNextTurnPrompt(backToFirst)).toBe(
			"Run the checks for the files the last turn changed.",
		);
	});

	it("resets a new event to its first suggestion", () => {
		const previous = readNextTurnSuggestions({
			sessionId: "session-1",
			draft: "",
			payload,
		});
		if (!previous) throw new Error("Expected suggestions");
		const skipped = cycleNextTurnSuggestions(previous);

		const replacement = readNextTurnSuggestions({
			sessionId: "session-1",
			draft: "",
			payload: {
				...payload,
				runId: "run-2",
				suggestions: [
					{ prompt: "Start the next task." },
					{ prompt: "Inspect the previous run." },
				],
			},
		});

		expect(currentNextTurnPrompt(skipped)).toBe(
			"Review the changes from the last turn before going on.",
		);
		expect(replacement).toEqual({
			prompts: ["Start the next task.", "Inspect the previous run."],
			index: 0,
		});
	});

	it("ignores a non-empty draft and a different trusted session", () => {
		expect(
			readNextTurnSuggestions({
				sessionId: "session-1",
				draft: "keep this",
				payload,
			}),
		).toBeNull();
		expect(
			readNextTurnSuggestions({
				sessionId: "session-2",
				draft: "",
				payload,
			}),
		).toBeNull();
	});

	it("ignores malformed or empty suggestion events", () => {
		expect(
			readNextTurnSuggestions({
				sessionId: "session-1",
				draft: "",
				payload: { ...payload, suggestions: [] },
			}),
		).toBeNull();
		expect(
			readNextTurnSuggestions({
				sessionId: "session-1",
				draft: "",
				payload: null,
			}),
		).toBeNull();
		expect(
			readNextTurnSuggestions({
				sessionId: "session-1",
				draft: "",
				payload: { ...payload, runId: "" },
			}),
		).toBeNull();
	});

	it("hides stored suggestions while a run is in flight", () => {
		const accepted = acceptNextTurnSuggestions({
			sessionId: "session-1",
			draft: "",
			payload,
			memory: EMPTY_NEXT_TURN_THREAD,
		});
		if (!accepted) throw new Error("Expected suggestions");

		expect(
			visibleNextTurnSuggestions(accepted.state, true),
		).toBeUndefined();
		expect(visibleNextTurnSuggestions(accepted.state, false)).toEqual(
			accepted.state,
		);
	});

	it("ignores a late event once a newer run has started", () => {
		const rules = acceptNextTurnSuggestions({
			sessionId: "session-1",
			draft: "",
			payload,
			memory: EMPTY_NEXT_TURN_THREAD,
		});
		if (!rules) throw new Error("Expected suggestions");
		const left = markNewerNextTurnRun(rules.memory);

		expect(
			acceptNextTurnSuggestions({
				sessionId: "session-1",
				draft: "",
				payload: {
					...payload,
					suggestions: [{ prompt: "Look at the specific failure in a.ts." }],
				},
				memory: left,
			}),
		).toBeNull();
		expect(left.acceptedRunIds).toEqual(["run-1"]);
	});

	it("ignores an event whose run id is older than the latest accepted one", () => {
		const first = acceptNextTurnSuggestions({
			sessionId: "session-1",
			draft: "",
			payload,
			memory: EMPTY_NEXT_TURN_THREAD,
		});
		if (!first) throw new Error("Expected suggestions");
		const second = acceptNextTurnSuggestions({
			sessionId: "session-1",
			draft: "",
			payload: {
				...payload,
				runId: "run-2",
				suggestions: [{ prompt: "Check the new failure in b.ts." }],
			},
			memory: first.memory,
		});
		if (!second) throw new Error("Expected the newer run");

		expect(
			acceptNextTurnSuggestions({
				sessionId: "session-1",
				draft: "",
				payload: {
					...payload,
					suggestions: [{ prompt: "Look at the specific failure in a.ts." }],
				},
				memory: second.memory,
			}),
		).toBeNull();
		expect(second.state).toEqual({
			prompts: ["Check the new failure in b.ts."],
			index: 0,
		});
	});

	it("replaces the idle run's ghost with a later event and starts at the first prompt", () => {
		const rules = acceptNextTurnSuggestions({
			sessionId: "session-1",
			draft: "",
			payload,
			memory: EMPTY_NEXT_TURN_THREAD,
		});
		if (!rules?.state) throw new Error("Expected suggestions");
		const cycled = cycleNextTurnSuggestions(rules.state);

		const model = acceptNextTurnSuggestions({
			sessionId: "session-1",
			draft: "",
			payload: {
				...payload,
				source: "model",
				suggestions: [
					{ prompt: "Run bun test on next-turn-suggestions.test.ts." },
				],
			},
			memory: rules.memory,
		});

		expect(currentNextTurnPrompt(cycled)).toBe(
			"Review the changes from the last turn before going on.",
		);
		expect(model).toEqual({
			state: {
				prompts: ["Run bun test on next-turn-suggestions.test.ts."],
				index: 0,
			},
			memory: rules.memory,
		});
		expect(visibleNextTurnSuggestions(model?.state, false)?.prompts).toEqual([
			"Run bun test on next-turn-suggestions.test.ts.",
		]);
	});
});
