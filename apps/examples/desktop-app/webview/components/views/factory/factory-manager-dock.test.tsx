// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureLocalStorage } from "@/lib/test-local-storage";
import { FactoryManagerDock } from "./factory-manager-dock";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	ensureLocalStorage();
	window.localStorage.clear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

function hostWidth(width: number) {
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
		width,
	} as DOMRect);
}

function render(props: Partial<Parameters<typeof FactoryManagerDock>[0]> = {}) {
	const handlers = {
		onClose: vi.fn(),
		onNewConversation: vi.fn(),
		onOpenFullPage: vi.fn(),
		onDismissContext: vi.fn(),
	};
	act(() =>
		root.render(
			<FactoryManagerDock
				open
				{...handlers}
				main={<button type="button">Card</button>}
				panel={<textarea aria-label="Message" />}
				{...props}
			/>,
		),
	);
	return handlers;
}

const panel = () =>
	container.querySelector('section[aria-label="Ask Factory"]');
const main = () =>
	container.querySelector<HTMLElement>(
		'[data-testid="factory-manager-dock-main"]',
	);
const button = (label: string) =>
	container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const pressEscape = (target: Element) =>
	act(() => {
		target.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});

describe("FactoryManagerDock", () => {
	it("shows Ask Factory beside Factory and hides it without unmounting", () => {
		hostWidth(1400);
		const { onClose } = render();
		expect(panel()).not.toBeNull();
		expect(main()?.hasAttribute("inert")).toBe(false);
		expect(main()?.style.display).toBe("flex");
		button("Close Ask Factory")?.click();
		expect(onClose).toHaveBeenCalledOnce();

		render({ open: false });
		// Hidden, not removed: the conversation keeps its state.
		expect(panel()?.closest("aside")?.style.display).toBe("none");
		expect(
			container.querySelector('textarea[aria-label="Message"]'),
		).not.toBeNull();
	});

	it("takes the whole Factory area when it is narrow, keeping Factory mounted but inert", () => {
		hostWidth(900);
		const { onClose } = render();
		expect(main()?.style.display).toBe("none");
		expect(main()?.hasAttribute("inert")).toBe(true);
		expect(container.textContent).toContain("Card");
		expect(button("Close Ask Factory")).toBeNull();
		const back = [...container.querySelectorAll("button")].find(
			(candidate) => candidate.textContent === "Back to Factory",
		);
		back?.click();
		expect(onClose).toHaveBeenCalledOnce();
		// Esc leaves the takeover, but never from the composer.
		const textarea = container.querySelector("textarea");
		if (textarea) pressEscape(textarea);
		expect(onClose).toHaveBeenCalledOnce();
		pressEscape(button("New conversation") as Element);
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it("closes on Esc from the header only when docked", () => {
		hostWidth(1400);
		const { onClose } = render();
		const textarea = container.querySelector("textarea");
		if (textarea) pressEscape(textarea);
		expect(onClose).not.toHaveBeenCalled();
		pressEscape(button("Open full page") as Element);
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("offers the open card as dismissible context and its header actions", () => {
		hostWidth(1400);
		const handlers = render({ contextCard: { shortId: "F25" } });
		expect(panel()?.textContent).toContain("About F25");
		button("Don't send F25 as context")?.click();
		button("New conversation")?.click();
		button("Open full page")?.click();
		expect(handlers.onDismissContext).toHaveBeenCalledOnce();
		expect(handlers.onNewConversation).toHaveBeenCalledOnce();
		expect(handlers.onOpenFullPage).toHaveBeenCalledOnce();

		render({ contextCard: null });
		expect(panel()?.textContent).not.toContain("About");
	});
	it("shows an optional notice above the conversation", () => {
		hostWidth(1400);
		render();
		expect(
			container.querySelector('[data-testid="factory-manager-dock-notice"]'),
		).toBeNull();
		const onReview = vi.fn();
		render({
			notice: (
				<span>
					Proposed rule from F12 ·{" "}
					<button type="button" onClick={onReview}>
						Review
					</button>
				</span>
			),
		});
		const notice = container.querySelector(
			'[data-testid="factory-manager-dock-notice"]',
		);
		expect(notice?.textContent).toBe("Proposed rule from F12 · Review");
		expect(panel()?.contains(notice ?? null)).toBe(true);
		notice?.querySelector("button")?.click();
		expect(onReview).toHaveBeenCalledOnce();
	});
});
