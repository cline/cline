import type { KeyEvent } from "@opentui/core";
import { describe, expect, it, vi } from "vitest";
import { shouldHandleInputHistory } from "./root-keyboard-routing";
import { useRootKeyboard } from "./use-root-keyboard";

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

describe("cloud target keybinds", () => {
	const keyboardInput = (handlers: {
		onToggleCloudTarget?: () => void;
		onChangeCloudRepo?: () => void;
	}) =>
		({
			isDialogOpen: false,
			appView: "home",
			autocomplete: { mode: false },
			transcriptScrollRef: { current: null },
			getCurrentInputText: () => "",
			queuedPromptSelection: { items: [], selectedId: null, editingId: null },
			...handlers,
		}) as unknown as Parameters<typeof useRootKeyboard>[0];

	const pressCtrl = (name: string) => {
		const preventDefault = vi.fn();
		keyboard.handle({
			name,
			ctrl: true,
			meta: false,
			shift: false,
			preventDefault,
		} as unknown as KeyEvent);
		return preventDefault;
	};

	it("toggles the target with Ctrl+O and changes the repository with Ctrl+K", () => {
		const onToggleCloudTarget = vi.fn();
		const onChangeCloudRepo = vi.fn();
		useRootKeyboard(keyboardInput({ onToggleCloudTarget, onChangeCloudRepo }));
		expect(pressCtrl("o")).toHaveBeenCalledOnce();
		expect(pressCtrl("k")).toHaveBeenCalledOnce();
		expect(onToggleCloudTarget).toHaveBeenCalledOnce();
		expect(onChangeCloudRepo).toHaveBeenCalledOnce();
	});

	it("ignores Tab and Shift+Tab while Cloud is selected", () => {
		const onToggleMode = vi.fn();
		useRootKeyboard({
			...keyboardInput({}),
			isCloudTarget: true,
			onToggleMode,
		});
		for (const shift of [false, true]) {
			keyboard.handle({
				name: "tab",
				ctrl: false,
				meta: false,
				shift,
				preventDefault: vi.fn(),
			} as unknown as KeyEvent);
		}
		expect(onToggleMode).not.toHaveBeenCalled();
	});

	it("leaves Ctrl+O and Ctrl+K to the input when cloud is unavailable", () => {
		useRootKeyboard(keyboardInput({}));
		expect(pressCtrl("o")).not.toHaveBeenCalled();
		expect(pressCtrl("k")).not.toHaveBeenCalled();
	});
});
