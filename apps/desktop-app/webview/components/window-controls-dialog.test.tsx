// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { WindowControls } from "@/components/window-title-bar";

const windowMocks = vi.hoisted(() => ({
	close: vi.fn(),
	isMaximized: vi.fn(async () => false),
	minimize: vi.fn(),
	onResized: vi.fn(async () => () => undefined),
	toggleMaximize: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => windowMocks,
}));
vi.mock("@/lib/desktop-client", () => ({ isTauriAvailable: () => true }));

it("invokes caption actions without dismissing or taking pointer focus from a modal", async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.stubGlobal("navigator", { userAgent: "Windows NT 10.0" });
	// Next hydrates document: React and Radix share its event listeners.
	const root = createRoot(document);
	const onOpenChange = vi.fn();
	try {
		await act(async () => {
			root.render(
				<html lang="en">
					<head />
					<body>
						<WindowControls />
						<Dialog defaultOpen onOpenChange={onOpenChange}>
							<DialogContent>
								<DialogTitle>Settings</DialogTitle>
								<DialogDescription>Edit settings</DialogDescription>
								<input aria-label="Setting" />
							</DialogContent>
						</Dialog>
					</body>
				</html>,
			);
		});
		// Radix registers its document pointer listener on the next timer turn.
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
		expect(document.body.style.pointerEvents).toBe("none");
		const modal = document.querySelector('[role="dialog"]');
		const focused = document.activeElement;
		expect(modal?.contains(focused)).toBe(true);
		const buttons = document.querySelectorAll<HTMLButtonElement>(
			'[data-slot="window-controls"] button',
		);
		expect(buttons).toHaveLength(3);
		for (const button of buttons) {
			const pointerDown = new MouseEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
			});
			await act(async () => {
				button.dispatchEvent(pointerDown);
				button.click();
			});
			expect(pointerDown.defaultPrevented).toBe(true);
			expect(document.activeElement).toBe(focused);
			expect(onOpenChange).not.toHaveBeenCalled();
			expect(document.querySelector('[role="dialog"]')).toBe(modal);
		}
		expect(windowMocks.minimize).toHaveBeenCalledOnce();
		expect(windowMocks.toggleMaximize).toHaveBeenCalledOnce();
		expect(windowMocks.close).toHaveBeenCalledOnce();
	} finally {
		await act(async () => root.unmount());
		vi.unstubAllGlobals();
	}
});
