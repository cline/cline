import { describe, expect, it, vi } from "vitest";
import { DialogManager, type FocusHost } from "./manager";

function createHost(): FocusHost & {
	focusable: {
		blur: ReturnType<typeof vi.fn>;
		focus: ReturnType<typeof vi.fn>;
		isDestroyed: boolean;
	};
} {
	const focusable = { blur: vi.fn(), focus: vi.fn(), isDestroyed: false };
	return { currentFocusedRenderable: focusable, focusable };
}

describe("DialogManager", () => {
	it("stacks dialogs and closes the top-most by default", () => {
		const manager = new DialogManager(createHost());
		const first = manager.show({ content: () => null });
		const second = manager.show({ content: () => null });
		expect(manager.getDialogs().map((d) => d.id)).toEqual([first, second]);
		expect(manager.getTopDialog()?.id).toBe(second);

		expect(manager.close()).toBe(second);
		expect(manager.getTopDialog()?.id).toBe(first);
		expect(manager.close(first)).toBe(first);
		expect(manager.isOpen()).toBe(false);
	});

	it("updates a dialog in place when re-shown with the same id", () => {
		const manager = new DialogManager(createHost());
		manager.show({ id: "loading", content: () => "one" });
		manager.show({ id: "loading", content: () => "two" });
		expect(manager.getDialogs()).toHaveLength(1);
		expect(manager.getTopDialog()?.element).toBe("two");
	});

	it("notifies subscribers on show and close", () => {
		const manager = new DialogManager(createHost());
		const subscriber = vi.fn();
		const unsubscribe = manager.subscribe(subscriber);
		const id = manager.show({ content: () => null });
		manager.close(id);
		expect(subscriber).toHaveBeenCalledTimes(2);
		unsubscribe();
		manager.show({ content: () => null });
		expect(subscriber).toHaveBeenCalledTimes(2);
	});

	it("blurs focus on first open and restores it after the last close", async () => {
		vi.useFakeTimers();
		try {
			const host = createHost();
			const manager = new DialogManager(host);
			const first = manager.show({ content: () => null });
			expect(host.focusable.blur).toHaveBeenCalledTimes(1);
			const second = manager.show({ content: () => null });

			manager.close(second);
			await vi.runAllTimersAsync();
			expect(host.focusable.focus).not.toHaveBeenCalled();

			manager.close(first);
			await vi.runAllTimersAsync();
			expect(host.focusable.focus).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("resolves choice() with the selected key and closes the dialog", async () => {
		const manager = new DialogManager(createHost());
		let context: { resolve: (key: string) => void } | undefined;
		const result = manager.choice<string>({
			content: (ctx) => {
				context = ctx;
				return null;
			},
		});
		expect(manager.isOpen()).toBe(true);
		context?.resolve("picked");
		await expect(result).resolves.toBe("picked");
		expect(manager.isOpen()).toBe(false);
	});

	it("resolves choice() with the fallback when closed externally (ESC path)", async () => {
		const manager = new DialogManager(createHost());
		const result = manager.choice<string>({
			fallback: "fell-back",
			content: () => null,
		});
		manager.close();
		await expect(result).resolves.toBe("fell-back");
	});

	it("resolves confirm() with false when dismissed", async () => {
		const manager = new DialogManager(createHost());
		let context: { dismiss: () => void } | undefined;
		const result = manager.confirm({
			content: (ctx) => {
				context = ctx;
				return null;
			},
		});
		context?.dismiss();
		await expect(result).resolves.toBe(false);
	});

	it("ignores a second resolution of the same async dialog", async () => {
		const manager = new DialogManager(createHost());
		let context: { resolve: (key: string) => void } | undefined;
		const result = manager.choice<string>({
			content: (ctx) => {
				context = ctx;
				return null;
			},
		});
		context?.resolve("first");
		context?.resolve("second");
		await expect(result).resolves.toBe("first");
	});

	it("replace() closes existing dialogs before showing the new one", () => {
		const manager = new DialogManager(createHost());
		manager.show({ content: () => null });
		manager.show({ content: () => null });
		const id = manager.replace({ content: () => "replacement" });
		expect(manager.getDialogs().map((d) => d.id)).toEqual([id]);
	});

	it("calls onOpen and onClose lifecycle hooks", () => {
		const manager = new DialogManager(createHost());
		const onOpen = vi.fn();
		const onClose = vi.fn();
		const id = manager.show({ content: () => null, onOpen, onClose });
		expect(onOpen).toHaveBeenCalledTimes(1);
		manager.close(id);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("throws when showing after destroy", () => {
		const manager = new DialogManager(createHost());
		manager.destroy();
		expect(() => manager.show({ content: () => null })).toThrow(
			/manager destroyed/,
		);
	});
});
