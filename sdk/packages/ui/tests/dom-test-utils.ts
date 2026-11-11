import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach } from "vitest";

export function createDomFixture() {
	let container: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	return {
		get container() {
			return container;
		},
		async render(node: ReactNode) {
			await act(async () => root.render(node));
		},
	};
}

export async function pressKey(target: Element, key: string, shiftKey = false) {
	await act(async () => {
		target.dispatchEvent(
			new KeyboardEvent("keydown", {
				key,
				shiftKey,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
}

export async function clickOutside(overlaySelector: string) {
	// Radix installs its pointer listener on the next task to ignore the opener.
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
		const overlay = document.querySelector(overlaySelector);
		if (!overlay) throw new Error("Missing dialog overlay");
		overlay.dispatchEvent(
			new MouseEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
				button: 0,
			}),
		);
	});
}
