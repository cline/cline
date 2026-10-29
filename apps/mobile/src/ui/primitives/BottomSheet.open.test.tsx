import { Keyboard, type KeyboardEventListener } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expandBottomSheetAfterKeyboardDismiss } from "./BottomSheet";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("opening pickers from focused inputs", () => {
	it("blurs hardware-keyboard focus even when no software keyboard is visible", () => {
		vi.spyOn(Keyboard, "isVisible").mockReturnValue(false);
		const dismiss = vi.spyOn(Keyboard, "dismiss");
		const expand = vi.fn();
		expandBottomSheetAfterKeyboardDismiss({ current: { expand } });
		expect(dismiss).toHaveBeenCalledOnce();
		expect(expand).toHaveBeenCalledOnce();
		expect(dismiss.mock.invocationCallOrder[0]).toBeLessThan(
			expand.mock.invocationCallOrder[0]!,
		);
	});
	it("waits for software keyboard dismissal and opens once even if the fallback also runs", () => {
		vi.useFakeTimers();
		vi.spyOn(Keyboard, "isVisible").mockReturnValue(true);
		let hidden: KeyboardEventListener | undefined;
		const remove = vi.fn();
		vi.spyOn(Keyboard, "addListener").mockImplementation((_name, callback) => {
			hidden = callback;
			return { remove } as unknown as ReturnType<typeof Keyboard.addListener>;
		});
		const dismiss = vi.spyOn(Keyboard, "dismiss");
		const expand = vi.fn();
		expandBottomSheetAfterKeyboardDismiss({ current: { expand } });
		expect(dismiss).toHaveBeenCalledOnce();
		expect(expand).not.toHaveBeenCalled();
		if (!hidden) throw new Error("No keyboard hide listener");
		hidden({} as Parameters<KeyboardEventListener>[0]);
		vi.runAllTimers();
		expect(expand).toHaveBeenCalledOnce();
		expect(remove).toHaveBeenCalledOnce();
	});
});
