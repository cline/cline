import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TuiProps } from "../types";
import { useRuntimeDialogBridge } from "./use-runtime-dialog-bridge";

const effects = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }));
vi.mock("react", () => ({
	useCallback: <T>(callback: T) => callback,
	useRef: <T>(current: T) => ({ current }),
	useState: <T>(initial: T) => [initial, vi.fn()],
	useEffect: (effect: () => (() => void) | undefined) => {
		const cleanup = effect();
		if (cleanup) effects.cleanups.push(cleanup);
	},
}));

beforeEach(() => {
	effects.cleanups.length = 0;
});

function setup() {
	let askQuestion: Parameters<TuiProps["setAskQuestion"]>[0];
	// biome-ignore lint/correctness/useHookAtTopLevel: React hooks are mocked to exercise registration and cleanup without a renderer.
	const bridge = useRuntimeDialogBridge({
		setAskQuestion: (handler) => {
			askQuestion = handler;
		},
		setToolApprover: vi.fn(),
		setModeChangeNotifier: vi.fn(),
		setUiMode: vi.fn(),
		refocusTextarea: vi.fn(),
	});
	return {
		bridge,
		ask: () => {
			if (!askQuestion) throw new Error("Question handler not registered");
			return askQuestion("Which?", ["a", "b"]);
		},
	};
}

describe("question dismissal", () => {
	it("resolves Esc as an empty answer", async () => {
		const { bridge, ask } = setup();
		const answer = ask();
		bridge.resolveAskQuestion(1, null);
		await expect(answer).resolves.toBe("");
	});

	it("resolves active and queued questions as empty on teardown", async () => {
		const { ask } = setup();
		const active = ask();
		const queued = ask();
		for (const cleanup of effects.cleanups) cleanup();
		await expect(active).resolves.toBe("");
		await expect(queued).resolves.toBe("");
	});

	it("preserves real answers verbatim", async () => {
		const { bridge, ask } = setup();
		const answer = ask();
		bridge.resolveAskQuestion(1, 'use $& and "$1"');
		await expect(answer).resolves.toBe('use $& and "$1"');
	});
});
