// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNextTurnSuggestions } from "./next-turn-suggestions";

const { handlers } = vi.hoisted(() => ({
	handlers: new Set<(payload: unknown) => void>(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		subscribe: (_eventName: string, handler: (payload: unknown) => void) => {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
	},
}));

type Props = { sessionId: string; status: string; turnEpoch: number };
type Hook = ReturnType<typeof useNextTurnSuggestions>;

let root: Root;
let container: HTMLDivElement;
let current: Hook;
const promptInputRef = { current: "" };
const setPromptInput = vi.fn((value: string) => {
	promptInputRef.current = value;
});

function Harness(props: Props) {
	current = useNextTurnSuggestions({
		...props,
		promptInputRef,
		setPromptInput,
	});
	return null;
}

function render(props: Props) {
	act(() => root.render(<Harness {...props} />));
}

function emit(runId: string, prompts: string[], sessionId = "session-1") {
	act(() => {
		for (const handler of handlers) {
			handler({
				sessionId,
				runId,
				suggestions: prompts.map((prompt) => ({ prompt })),
			});
		}
	});
}

const idle: Props = { sessionId: "session-1", status: "idle", turnEpoch: 0 };

beforeEach(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	root = createRoot(container);
	promptInputRef.current = "";
	setPromptInput.mockClear();
});

afterEach(() => {
	act(() => root.unmount());
	handlers.clear();
});

describe("useNextTurnSuggestions", () => {
	it("shows the first prompt and writes it to the draft on accept", () => {
		render(idle);
		emit("run-1", ["Run the checks.", "Review the diff."]);
		expect(current.suggestion).toBe("Run the checks.");

		act(() => current.navigate("next"));
		expect(current.suggestion).toBe("Review the diff.");

		act(() => current.accept());
		expect(setPromptInput).toHaveBeenCalledWith("Review the diff.");
		expect(current.suggestion).toBeUndefined();
	});

	it("drops the stored set when a new run starts and ignores its late event", () => {
		render(idle);
		emit("run-1", ["Run the checks."]);
		render({ ...idle, status: "running" });
		expect(current.suggestion).toBeUndefined();

		emit("run-1", ["Stale prompt."]);
		render({ ...idle, status: "completed" });
		expect(current.suggestion).toBeUndefined();

		emit("run-2", ["Fresh prompt."]);
		expect(current.suggestion).toBe("Fresh prompt.");
	});

	it("drops the stored set on a new turn and on a session change", () => {
		render(idle);
		emit("run-1", ["Run the checks."]);
		render({ ...idle, turnEpoch: 1 });
		expect(current.suggestion).toBeUndefined();

		emit("run-2", ["Review the diff."]);
		render({ ...idle, sessionId: "session-2", turnEpoch: 1 });
		expect(current.suggestion).toBeUndefined();

		emit("run-2", ["Other session."], "session-1");
		expect(current.suggestion).toBeUndefined();
	});
});
