// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePaginationScroll } from "./use-pagination-scroll";

class ResizeObserverStub {
	observe() {}
	disconnect() {}
}

let container: HTMLDivElement;
let root: Root;
let changePage: (page: number) => void;

function Harness({
	page,
	onPageChange,
}: {
	page: number;
	onPageChange: (page: number) => false | undefined;
}) {
	const pagination = usePaginationScroll({
		page,
		resetKey: "results",
		onPageChange,
	});
	changePage = pagination.onPageChange;
	return (
		<div data-slot="scroll-area-viewport">
			<div
				ref={pagination.contentRef}
				data-content=""
				style={{ minHeight: 12 }}
			>
				Results
			</div>
		</div>
	);
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			return new DOMRect(0, 0, 600, this.dataset.content === "" ? 300 : 600);
		},
	);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function elements() {
	const viewport = container.querySelector<HTMLElement>(
		'[data-slot="scroll-area-viewport"]',
	);
	const content = container.querySelector<HTMLElement>("[data-content]");
	if (!viewport || !content) throw new Error("Missing pagination fixture");
	return { viewport, content };
}

it("restores the previous inline height when a page change is rejected", async () => {
	const onPageChange = vi.fn(() => false);
	await act(async () =>
		root.render(<Harness page={1} onPageChange={onPageChange} />),
	);
	const { content } = elements();

	await act(async () => changePage(2));
	expect(onPageChange).toHaveBeenCalledExactlyOnceWith(2);
	expect(content.style.minHeight).toBe("12px");
});

it("keeps the reservation through a commit and restores owned styles on cleanup", async () => {
	const onPageChange = vi.fn();
	await act(async () =>
		root.render(<Harness page={1} onPageChange={onPageChange} />),
	);
	const { content, viewport } = elements();
	viewport.scrollTop = 180;

	await act(async () => changePage(2));
	expect(content.style.minHeight).toBe("300px");
	viewport.scrollTop = 0;
	await act(async () =>
		root.render(<Harness page={2} onPageChange={onPageChange} />),
	);
	expect(viewport.scrollTop).toBe(180);
	expect(content.style.minHeight).toBe("300px");

	await act(async () => root.render(null));
	expect(content.style.minHeight).toBe("12px");
});
