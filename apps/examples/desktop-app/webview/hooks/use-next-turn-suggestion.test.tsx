// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type NextTurnSuggestionOptions,
	useNextTurnSuggestion,
} from "./use-next-turn-suggestion";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));

let container: HTMLDivElement;
let root: Root;
let current: ReturnType<typeof useNextTurnSuggestion>;

const defaults: NextTurnSuggestionOptions = {
	enabled: true,
	environmentId: "local",
	sessionId: "session-1",
	workspaceRoot: "/workspace",
	busy: false,
	draft: "",
};

function Probe(options: NextTurnSuggestionOptions) {
	current = useNextTurnSuggestion(options);
	return null;
}

async function render(options: Partial<NextTurnSuggestionOptions> = {}) {
	await act(async () => {
		root.render(<Probe {...defaults} {...options} />);
		for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
	});
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	invoke.mockReset();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("useNextTurnSuggestion", () => {
	it("offers the best candidate first and cycles locally", async () => {
		invoke.mockResolvedValue(["verify", "review", "wrap up"]);
		await render();
		expect(current).toMatchObject({ prompt: "verify", position: 1, count: 3 });

		act(() => current.cycle());
		expect(current).toMatchObject({ prompt: "review", position: 2 });
		act(() => current.cycle());
		expect(current).toMatchObject({ prompt: "wrap up", position: 3 });
		act(() => current.cycle());
		expect(current).toMatchObject({ prompt: "verify", position: 1 });
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it("does not apply a response after the user types or clear it by erasing", async () => {
		const response = deferred<string[]>();
		invoke.mockReturnValue(response.promise);
		await render();
		await render({ draft: "my own prompt" });
		await act(async () => response.resolve(["stale suggestion"]));
		expect(current.prompt).toBeUndefined();

		await render({ draft: "" });
		expect(current.prompt).toBeUndefined();
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it("invalidates a pending response when a new run starts", async () => {
		const response = deferred<string[]>();
		invoke.mockReturnValueOnce(response.promise);
		await render();
		await render({ busy: true });
		await act(async () => response.resolve(["old turn"]));
		expect(current.prompt).toBeUndefined();

		invoke.mockResolvedValue(["new turn"]);
		await render({ busy: false });
		expect(current.prompt).toBe("new turn");
		expect(invoke).toHaveBeenCalledTimes(2);
	});

	it("ignores responses from a previous session", async () => {
		const response = deferred<string[]>();
		invoke
			.mockReturnValueOnce(response.promise)
			.mockResolvedValue(["current session"]);
		await render();
		await render({ sessionId: "session-2" });
		expect(current.prompt).toBe("current session");
		await act(async () => response.resolve(["previous session"]));
		expect(current.prompt).toBe("current session");
	});

	it("does nothing without an eligible local session", async () => {
		await render({ enabled: false });
		await render({ enabled: true, sessionId: null });
		expect(current.prompt).toBeUndefined();
		expect(invoke).not.toHaveBeenCalled();
	});

	it("dismisses without making another request", async () => {
		invoke.mockResolvedValue(["verify"]);
		await render();
		expect(current.prompt).toBe("verify");
		act(() => current.dismiss());
		expect(current.prompt).toBeUndefined();
		await render();
		expect(invoke).toHaveBeenCalledTimes(1);
	});
});
