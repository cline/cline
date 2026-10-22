import type { KeyEvent } from "@opentui/core";
import { describe, expect, it, vi } from "vitest";
import { useRootKeyboard } from "./use-root-keyboard";
import { shouldHandleInputHistory } from "./root-keyboard-routing";

describe("root keyboard input history routing", () => {
	it("handles history while idle", () => {
		expect(
			shouldHandleInputHistory({
				isRunning: false,
				hasQueuedPrompts: false,
			}),
		).toBe(true);
	});

	it("handles history during a running turn when the prompt queue is empty", () => {
		expect(
			shouldHandleInputHistory({
				isRunning: true,
				hasQueuedPrompts: false,
			}),
		).toBe(true);
	});

	it("keeps running-turn arrow keys reserved for queued prompts when the queue is populated", () => {
		expect(
			shouldHandleInputHistory({
				isRunning: true,
				hasQueuedPrompts: true,
			}),
		).toBe(false);
	});
});

const keyboard = vi.hoisted(() => ({ handle: (_key: KeyEvent) => {} }));
vi.mock("@opentui/react", () => ({
	useKeyboard: (handle: (key: KeyEvent) => void) => {
		keyboard.handle = handle;
	},
}));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useRef: (current: unknown) => ({ current }),
}));
vi.mock("../contexts/session-context", () => ({
	useSession: () => ({ isRunning: true, isExitRequested: false }),
}));

describe("empty-input queue steering", () => {
	it.each([
		{ text: "", shift: false, promote: true },
		{ text: "   ", shift: false, promote: true },
		{ text: "new draft", shift: false, promote: false },
		{ text: "", shift: true, promote: false },
	])("routes Enter with $text and shift=$shift", ({ text, shift, promote }) => {
		const promotePrompt = vi.fn();
		useRootKeyboard({
			isDialogOpen: false,
			appView: "chat",
			autocomplete: { mode: false },
			transcriptScrollRef: { current: null },
			getCurrentInputText: () => text,
			queuedPromptSelection: {
				items: [
					{ id: "first", prompt: "first", steer: false, attachmentCount: 0 },
					{ id: "second", prompt: "second", steer: false, attachmentCount: 0 },
				],
				selectedId: null,
				editingId: null,
				promote: promotePrompt,
			},
		} as unknown as Parameters<typeof useRootKeyboard>[0]);
		const preventDefault = vi.fn();
		keyboard.handle({
			name: "return",
			ctrl: false,
			meta: false,
			shift,
			repeated: false,
			preventDefault,
		} as unknown as KeyEvent);
		expect(promotePrompt).toHaveBeenCalledTimes(promote ? 1 : 0);
		if (promote) {
			expect(promotePrompt).toHaveBeenCalledWith("first");
			expect(preventDefault).toHaveBeenCalledOnce();
		}
	});
});
