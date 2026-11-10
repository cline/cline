// @vitest-environment jsdom

import { act, createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pagination } from "../components/pagination.js";

let container: HTMLDivElement;
let root: Root;
const originalAnimate = Object.getOwnPropertyDescriptor(
	Element.prototype,
	"animate",
);

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	if (originalAnimate) {
		Object.defineProperty(Element.prototype, "animate", originalAnimate);
	} else {
		Reflect.deleteProperty(Element.prototype, "animate");
	}
});

async function render(node: ReactNode) {
	await act(async () => root.render(node));
}

function pageButtons() {
	return Array.from(
		container.querySelectorAll<HTMLButtonElement>("button[data-page]"),
	).filter((button) => !button.closest('[aria-hidden="true"], [hidden]'));
}

function pages() {
	return pageButtons().map((button) => Number(button.dataset.page));
}

function ellipses() {
	return Array.from(
		container.querySelectorAll<HTMLElement>(".cline-ui-pagination__ellipsis"),
	).filter((ellipsis) => !ellipsis.closest(".cline-ui-pagination__marker"));
}

function pageButton(page: number) {
	const button = pageButtons().find(
		(candidate) => Number(candidate.dataset.page) === page,
	);
	if (!button) throw new Error(`Expected a visible button for page ${page}`);
	return button;
}

function buttonNamed(name: string) {
	const button = Array.from(
		container.querySelectorAll<HTMLButtonElement>("button"),
	).find((candidate) => candidate.getAttribute("aria-label") === name);
	if (!button) throw new Error(`Expected a button named ${name}`);
	return button;
}

function currentPage() {
	return Number(
		container.querySelector<HTMLElement>('[aria-current="page"]')?.dataset.page,
	);
}

function expectSingleNumbers() {
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	const text: string[] = [];
	let node = walker.nextNode();
	while (node) {
		text.push(node.textContent ?? "");
		node = walker.nextNode();
	}
	for (const page of pages()) {
		expect(text.filter((value) => value === String(page))).toHaveLength(1);
	}
}

async function click(button: HTMLButtonElement) {
	await act(async () => button.click());
}

async function key(
	button: HTMLButtonElement,
	value: string,
	options: KeyboardEventInit = {},
) {
	const event = new KeyboardEvent("keydown", {
		key: value,
		bubbles: true,
		cancelable: true,
		...options,
	});
	await act(async () => button.dispatchEvent(event));
	return event;
}

function mockMotion(reduced: boolean) {
	const animations: {
		element: Element;
		keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
		cancel: ReturnType<typeof vi.fn>;
		playState: AnimationPlayState;
	}[] = [];
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches: !reduced,
			media: query,
		})),
	);
	const animate = vi.fn(function (
		this: Element,
		keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
	) {
		const cancel = vi.fn();
		const animation = {
			element: this,
			keyframes,
			cancel,
			playState: "running" as AnimationPlayState,
		};
		cancel.mockImplementation(() => {
			animation.playState = "idle";
		});
		animations.push(animation);
		return animation;
	});
	Object.defineProperty(Element.prototype, "animate", {
		configurable: true,
		writable: true,
		value: animate,
	});
	return { animate, animations };
}

function mockTrackOffset(offset: string) {
	const getStyle = globalThis.getComputedStyle;
	return vi
		.spyOn(globalThis, "getComputedStyle")
		.mockImplementation((element) => {
			const style = getStyle(element);
			return element.matches(".cline-ui-pagination__track")
				? new Proxy(style, {
						get(target, property) {
							if (property === "translate") return offset;
							if (property === "gridAutoColumns") return "40px";
							return Reflect.get(target, property, target);
						},
					})
				: style;
		});
}

describe("Pagination", () => {
	it("names the navigation and exposes one current page among native buttons", async () => {
		await render(<Pagination pageCount={10} />);

		expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe(
			"Pagination",
		);
		expect(pages()).toEqual([1, 2, 3, 10]);
		expect(currentPage()).toBe(1);
		expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
		expect(pageButton(2).getAttribute("aria-label")).toBe("Go to page 2");
		expect(buttonNamed("Previous page").disabled).toBe(true);
		expect(buttonNamed("Next page").disabled).toBe(false);
		expect(container.querySelector('[role="tab"], [role="radio"]')).toBeNull();
		for (const decoration of container.querySelectorAll(
			'[aria-hidden="true"]',
		)) {
			expect(
				decoration.querySelector(
					"button, a[href], input, select, textarea, [tabindex]",
				),
			).toBeNull();
		}
	});

	it("centers page navigation while keeping the window against either boundary", async () => {
		const onPageChange = vi.fn();
		await render(<Pagination onPageChange={onPageChange} pageCount={10} />);

		await click(buttonNamed("Previous page"));
		expect(onPageChange).not.toHaveBeenCalled();
		await click(buttonNamed("Next page"));
		expect(currentPage()).toBe(2);
		expect(pages()).toEqual([1, 2, 3, 10]);
		for (let page = 3; page <= 10; page += 1) {
			await click(buttonNamed("Next page"));
			expect(currentPage()).toBe(page);
		}
		expect(pages()).toEqual([1, 8, 9, 10]);
		expect(buttonNamed("Next page").disabled).toBe(true);
		await click(buttonNamed("Next page"));
		expect(onPageChange).toHaveBeenCalledTimes(9);

		await click(buttonNamed("Previous page"));
		expect(currentPage()).toBe(9);
		expect(pages()).toEqual([1, 8, 9, 10]);
		for (let page = 8; page >= 1; page -= 1) {
			await click(buttonNamed("Previous page"));
			expect(currentPage()).toBe(page);
		}
		expect(pages()).toEqual([1, 2, 3, 10]);
		expect(buttonNamed("Previous page").disabled).toBe(true);
		expect(onPageChange.mock.calls.map(([page]) => page)).toEqual([
			2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
		]);
	});

	it("keeps the same number of slots and width across every page and window size", async () => {
		for (const { pageCount, visiblePages, slots } of [
			{ pageCount: 20, visiblePages: undefined, slots: 5 },
			{ pageCount: 20, visiblePages: 5, slots: 5 },
			{ pageCount: 12, visiblePages: 8, slots: 8 },
			{ pageCount: 6, visiblePages: 1, slots: 5 },
			{ pageCount: 5, visiblePages: 5, slots: 5 },
			{ pageCount: 9, visiblePages: 9, slots: 9 },
			{ pageCount: 1, visiblePages: 5, slots: 1 },
		]) {
			let width: string | undefined;
			for (let page = 1; page <= pageCount; page += 1) {
				await render(
					<Pagination
						page={page}
						pageCount={pageCount}
						visiblePages={visiblePages}
					/>,
				);
				const nextWidth = container.querySelector<HTMLElement>(
					".cline-ui-pagination__pages",
				)?.style.inlineSize;
				width ??= nextWidth;
				expect(nextWidth).toBeTruthy();
				expect(nextWidth).toBe(width);
				expect(pageButtons().length + ellipses().length).toBe(slots);
				expect(currentPage()).toBe(page);
				expect(pages()[0]).toBe(1);
				expect(pages().at(-1)).toBe(pageCount);
				expectSingleNumbers();
			}
		}
	});

	it("supports direct page jumps without reporting reselection", async () => {
		const onPageChange = vi.fn();
		await render(<Pagination pageCount={20} onPageChange={onPageChange} />);

		await click(pageButton(1));
		expect(onPageChange).not.toHaveBeenCalled();
		await click(pageButton(3));
		expect(currentPage()).toBe(3);
		expect(pages()).toEqual([1, 2, 3, 20]);
		expect(onPageChange).toHaveBeenCalledExactlyOnceWith(3);
		await click(pageButton(3));
		expect(onPageChange).toHaveBeenCalledOnce();
	});

	it.each([
		{ defaultPage: 1, visible: [1, 2, 3, 10], gaps: 1 },
		{ defaultPage: 3, visible: [1, 2, 3, 10], gaps: 1 },
		{ defaultPage: 4, visible: [1, 4, 10], gaps: 2 },
		{ defaultPage: 5, visible: [1, 5, 10], gaps: 2 },
		{ defaultPage: 6, visible: [1, 6, 10], gaps: 2 },
		{ defaultPage: 8, visible: [1, 8, 9, 10], gaps: 1 },
		{ defaultPage: 10, visible: [1, 8, 9, 10], gaps: 1 },
	])("centers initial page $defaultPage with endpoints and ellipses only for omitted pages", async ({
		defaultPage,
		visible,
		gaps,
	}) => {
		await render(<Pagination pageCount={10} defaultPage={defaultPage} />);
		expect(pages()).toEqual(visible);
		expect(new Set(pages()).size).toBe(pages().length);
		expect(ellipses()).toHaveLength(gaps);
		for (const ellipsis of ellipses()) {
			expect(ellipsis.getAttribute("aria-hidden")).toBe("true");
			expect(ellipsis.textContent).toMatch(/^(?:\.\.\.|…)$/);
			expect(ellipsis.matches("button, [tabindex]")).toBe(false);
		}
	});

	it("moves the window to either end when selecting the first or last page", async () => {
		const onPageChange = vi.fn();
		await render(
			<Pagination
				defaultPage={10}
				pageCount={20}
				onPageChange={onPageChange}
			/>,
		);
		expect(pages()).toEqual([1, 10, 20]);

		await click(pageButton(20));
		expect(currentPage()).toBe(20);
		expect(pages()).toEqual([1, 18, 19, 20]);
		await click(buttonNamed("Previous page"));
		expect(currentPage()).toBe(19);
		expect(pages()).toEqual([1, 18, 19, 20]);
		await click(pageButton(1));
		expect(currentPage()).toBe(1);
		expect(pages()).toEqual([1, 2, 3, 20]);
		await click(buttonNamed("Next page"));
		expect(currentPage()).toBe(2);
		expect(pages()).toEqual([1, 2, 3, 20]);
		expect(onPageChange.mock.calls.map(([page]) => page)).toEqual([
			20, 19, 1, 2,
		]);
	});

	it("leaves a controlled page and its window unchanged until the host accepts it", async () => {
		const onPageChange = vi.fn();
		const control = (page: number) => (
			<Pagination page={page} pageCount={10} onPageChange={onPageChange} />
		);
		await render(control(1));

		await click(buttonNamed("Next page"));
		expect(onPageChange).toHaveBeenCalledExactlyOnceWith(2);
		expect(currentPage()).toBe(1);
		expect(pages()).toEqual([1, 2, 3, 10]);
		await render(control(2));
		expect(currentPage()).toBe(2);
		expect(pages()).toEqual([1, 2, 3, 10]);
		await render(control(6));
		expect(currentPage()).toBe(6);
		expect(pages()).toEqual([1, 6, 10]);
		await render(control(10));
		expect(currentPage()).toBe(10);
		expect(pages()).toEqual([1, 8, 9, 10]);
		expect(onPageChange).toHaveBeenCalledOnce();
	});

	it("clamps selection and restores focus when results shrink without emitting a user change", async () => {
		const onPageChange = vi.fn();
		const control = (pageCount: number) => (
			<Pagination
				defaultPage={9}
				pageCount={pageCount}
				onPageChange={onPageChange}
			/>
		);
		await render(control(10));
		expect(currentPage()).toBe(9);
		pageButton(9).focus();
		await render(control(3));
		expect(currentPage()).toBe(3);
		expect(document.activeElement).toBe(pageButton(3));
		expect(onPageChange).not.toHaveBeenCalled();
		expect(pages()).toEqual([1, 2, 3]);
		expect(buttonNamed("Next page").disabled).toBe(true);
		await click(buttonNamed("Previous page"));
		expect(currentPage()).toBe(2);
		expect(onPageChange).toHaveBeenCalledExactlyOnceWith(2);
	});

	it("renders fewer buttons when fewer pages exist and disables both arrows for one page", async () => {
		await render(<Pagination pageCount={3} />);
		expect(pages()).toEqual([1, 2, 3]);
		expect(ellipses()).toHaveLength(0);
		await render(<Pagination pageCount={2} visiblePages={1} />);
		expect(pages()).toEqual([1, 2]);
		expect(ellipses()).toHaveLength(0);
		await click(pageButton(2));
		expect(currentPage()).toBe(2);
		expect(pages()).toEqual([1, 2]);
		await render(<Pagination pageCount={1} />);
		expect(pages()).toEqual([1]);
		expect(ellipses()).toHaveLength(0);
		expect(buttonNamed("Previous page").disabled).toBe(true);
		expect(buttonNamed("Next page").disabled).toBe(true);
	});

	it.each([
		0,
		-5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("omits navigation for an empty or invalid page count (%s)", async (pageCount) => {
		await render(<Pagination pageCount={pageCount} />);
		expect(container.querySelector("nav")).toBeNull();
		expect(container.querySelector("button")).toBeNull();
	});

	it("normalizes fractional counts and clamps out-of-range controlled pages", async () => {
		await render(<Pagination page={100} pageCount={3.9} />);
		expect(pages()).toEqual([1, 2, 3]);
		expect(currentPage()).toBe(3);
		await render(<Pagination page={-10} pageCount={3.9} />);
		expect(currentPage()).toBe(1);
		await render(<Pagination page={Number.NaN} pageCount={3.9} />);
		expect(currentPage()).toBe(1);
	});

	it("keeps the DOM bounded for huge page counts and supports a larger window", async () => {
		await render(<Pagination pageCount={1_000_000} defaultPage={500_000} />);
		expect(pages()).toEqual([1, 500_000, 1_000_000]);
		expect(pageButtons().length + ellipses().length).toBe(5);
		expect(container.querySelectorAll("button").length).toBeLessThanOrEqual(7);
		await click(buttonNamed("Next page"));
		expect(pages()).toEqual([1, 500_001, 1_000_000]);
		expect(pageButtons().length + ellipses().length).toBe(5);
		expect(container.querySelectorAll("button").length).toBeLessThanOrEqual(7);
		await render(<Pagination pageCount={1_000_000} visiblePages={7} />);
		expect(pageButtons()).toHaveLength(5);
		expect(pages()).toContain(currentPage());
	});

	it("recenters the selection when the window size changes, including even and single-page windows", async () => {
		const control = (visiblePages: number) => (
			<Pagination page={10} pageCount={20} visiblePages={visiblePages} />
		);
		await render(control(9));
		expect(pages()).toEqual([1, 8, 9, 10, 11, 12, 20]);
		await render(control(7));
		expect(pages()).toEqual([1, 9, 10, 11, 20]);
		await render(control(8));
		expect(pages()).toEqual([1, 8, 9, 10, 11, 20]);
		await render(control(5));
		expect(pages()).toEqual([1, 10, 20]);
		expect(currentPage()).toBe(10);
	});

	it("bounds oversized windows and recovers from non-finite window sizes", async () => {
		await render(<Pagination pageCount={1000} visiblePages={1_000_000} />);
		expect(pageButtons().length + ellipses().length).toBe(50);
		await render(<Pagination pageCount={1000} visiblePages={Number.NaN} />);
		expect(pageButtons().length + ellipses().length).toBe(5);
		await render(<Pagination pageCount={1000} visiblePages={1} />);
		expect(pages()).toEqual([1, 2, 3, 1000]);
		await click(buttonNamed("Next page"));
		expect(pages()).toEqual([1, 2, 3, 1000]);
		expect(currentPage()).toBe(2);
	});

	it("prevents all page changes while disabled", async () => {
		const onPageChange = vi.fn();
		await render(
			<Pagination
				defaultPage={3}
				disabled
				pageCount={10}
				onPageChange={onPageChange}
			/>,
		);

		for (const button of container.querySelectorAll<HTMLButtonElement>(
			"button",
		)) {
			expect(button.disabled).toBe(true);
			await click(button);
		}
		expect(currentPage()).toBe(3);
		expect(onPageChange).not.toHaveBeenCalled();
	});

	it("supports translated control labels and host navigation attributes", async () => {
		const ref = createRef<HTMLElement>();
		await render(
			<Pagination
				aria-label="Seiten"
				className="host-pagination"
				dir="rtl"
				getPageLabel={(page) => `Seite ${page}`}
				id="results-pages"
				nextLabel="Nächste Seite"
				pageCount={10}
				previousLabel="Vorherige Seite"
				ref={ref}
				style={{ marginTop: 8 }}
			/>,
		);
		expect(ref.current).toBe(container.querySelector("nav"));
		expect(ref.current?.getAttribute("aria-label")).toBe("Seiten");
		expect(ref.current?.id).toBe("results-pages");
		expect(ref.current?.classList.contains("host-pagination")).toBe(true);
		expect(ref.current?.dir).toBe("rtl");
		expect(ref.current?.style.marginTop).toBe("8px");
		expect(buttonNamed("Vorherige Seite").disabled).toBe(true);
		expect(buttonNamed("Nächste Seite").disabled).toBe(false);
		expect(pageButton(2).getAttribute("aria-label")).toBe("Seite 2");
	});

	it("does not submit an enclosing form when changing pages", async () => {
		const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
		await render(
			<form onSubmit={submit}>
				<Pagination pageCount={10} />
			</form>,
		);
		for (const button of container.querySelectorAll<HTMLButtonElement>(
			"button",
		)) {
			expect(button.type).toBe("button");
		}
		await click(pageButton(3));
		await click(buttonNamed("Next page"));
		expect(currentPage()).toBe(4);
		expect(submit).not.toHaveBeenCalled();
	});

	it.each([
		{ current: 1, focused: 2, keyName: "ArrowLeft" },
		{ current: 1, focused: 3, keyName: "Home" },
		{ current: 10, focused: 9, keyName: "ArrowRight" },
		{ current: 10, focused: 8, keyName: "End" },
	])("moves focus to selected page $current with $keyName without reporting reselection", async ({
		current,
		focused,
		keyName,
	}) => {
		const onPageChange = vi.fn();
		await render(
			<Pagination page={current} pageCount={10} onPageChange={onPageChange} />,
		);
		pageButton(focused).focus();

		expect((await key(pageButton(focused), keyName)).defaultPrevented).toBe(
			true,
		);
		expect(currentPage()).toBe(current);
		expect(document.activeElement).toBe(pageButton(current));
		expect(onPageChange).not.toHaveBeenCalled();
	});

	it("keeps keyboard focus on the selected page through ArrowRight, End and Home", async () => {
		await render(<Pagination pageCount={10} />);
		pageButton(1).focus();

		expect((await key(pageButton(1), "ArrowRight")).defaultPrevented).toBe(
			true,
		);
		expect(currentPage()).toBe(2);
		expect(document.activeElement).toBe(pageButton(2));
		await key(pageButton(2), "End");
		expect(currentPage()).toBe(10);
		expect(document.activeElement).toBe(pageButton(10));
		await key(pageButton(10), "Home");
		expect(currentPage()).toBe(1);
		expect(document.activeElement).toBe(pageButton(1));
		await key(pageButton(1), "ArrowLeft");
		expect(currentPage()).toBe(1);
		expect(document.activeElement).toBe(pageButton(1));
	});

	it("moves arrow-key selection relative to the focused number rather than the current page", async () => {
		await render(<Pagination pageCount={10} />);
		pageButton(2).focus();
		await key(pageButton(2), "ArrowRight");
		expect(currentPage()).toBe(3);
		expect(document.activeElement).toBe(pageButton(3));

		pageButton(3).focus();
		await key(pageButton(3), "ArrowLeft");
		expect(currentPage()).toBe(2);
		expect(document.activeElement).toBe(pageButton(2));
	});

	it("reverses horizontal keyboard navigation in RTL and respects host cancellation", async () => {
		const onKeyDown = vi.fn();
		await render(
			<Pagination
				defaultPage={3}
				dir="rtl"
				onKeyDown={onKeyDown}
				pageCount={10}
				style={{ direction: "rtl" }}
			/>,
		);
		pageButton(3).focus();
		await key(pageButton(3), "ArrowRight");
		expect(currentPage()).toBe(2);
		expect(document.activeElement).toBe(pageButton(2));
		await key(pageButton(2), "ArrowLeft");
		expect(currentPage()).toBe(3);
		expect(document.activeElement).toBe(pageButton(3));
		expect(onKeyDown).toHaveBeenCalledTimes(2);

		await render(
			<Pagination
				pageCount={10}
				onKeyDown={(event) => event.preventDefault()}
			/>,
		);
		await key(pageButton(3), "End");
		expect(currentPage()).toBe(3);
	});

	it.each([
		"altKey",
		"ctrlKey",
		"metaKey",
	] as const)("preserves native keyboard shortcuts with %s", async (modifier) => {
		const onPageChange = vi.fn();
		await render(
			<Pagination defaultPage={3} pageCount={10} onPageChange={onPageChange} />,
		);
		pageButton(3).focus();
		const event = await key(pageButton(3), "ArrowLeft", { [modifier]: true });
		expect(event.defaultPrevented).toBe(false);
		expect(currentPage()).toBe(3);
		expect(onPageChange).not.toHaveBeenCalled();
	});

	it("returns focus to the current page when shrinking the window removes a focused unselected page", async () => {
		await render(<Pagination pageCount={10} visiblePages={9} />);
		pageButton(5).focus();
		await render(<Pagination pageCount={10} visiblePages={5} />);
		expect(currentPage()).toBe(1);
		expect(document.activeElement).toBe(pageButton(1));
	});

	it("restores focus when a result-count change replaces the focused last page after a large jump", async () => {
		await render(<Pagination page={1} pageCount={100} visiblePages={9} />);
		await render(<Pagination page={50} pageCount={100} visiblePages={9} />);
		pageButton(100).focus();

		await render(<Pagination page={50} pageCount={101} visiblePages={9} />);
		expect(currentPage()).toBe(50);
		expect(document.activeElement).toBe(pageButton(50));
	});

	it("does not recapture focus after the page button was blurred", async () => {
		await render(<Pagination page={1} pageCount={10} />);
		pageButton(1).focus();
		pageButton(1).blur();
		expect(document.activeElement).toBe(document.body);
		await render(<Pagination page={2} pageCount={10} />);
		expect(document.activeElement).toBe(document.body);
	});

	it("keeps outside focus when results return after an empty result set", async () => {
		const content = (pageCount: number) => (
			<>
				<input aria-label="Filter results" />
				<Pagination pageCount={pageCount} />
			</>
		);
		await render(content(10));
		pageButton(1).focus();
		await render(content(0));
		const input = container.querySelector("input");
		input?.focus();
		expect(document.activeElement).toBe(input);
		await render(content(10));
		expect(document.activeElement).toBe(input);
	});

	it("updates the forwarded ref as an empty result set becomes populated and empty again", async () => {
		const ref = createRef<HTMLElement>();
		await render(<Pagination pageCount={0} ref={ref} />);
		expect(ref.current).toBeNull();
		await render(<Pagination pageCount={10} ref={ref} />);
		expect(ref.current).toBe(container.querySelector("nav"));
		expect(ref.current).not.toBeNull();
		await render(<Pagination pageCount={0} ref={ref} />);
		expect(ref.current).toBeNull();
	});

	it("skips motion when reduced motion is preferred", async () => {
		const { animate } = mockMotion(true);
		await render(<Pagination pageCount={10} />);
		await click(pageButton(3));
		await click(buttonNamed("Next page"));
		expect(currentPage()).toBe(4);
		expect(pages()).toEqual([1, 4, 10]);
		expect(animate).not.toHaveBeenCalled();
	});

	it("moves one page-sized marker from the first through the middle to the last slot", async () => {
		for (const [page, slot] of [
			[1, 0],
			[2, 1],
			[5, 2],
			[9, 3],
			[10, 4],
		] as const) {
			await render(<Pagination page={page} pageCount={10} />);
			const marker = container.querySelector<HTMLElement>(
				".cline-ui-pagination__marker",
			);
			const step = container.querySelector<HTMLElement>(
				".cline-ui-pagination__track",
			)?.style.gridAutoColumns;
			expect(marker?.style.inlineSize).toBe(pageButton(page).style.inlineSize);
			expect(marker?.style.translate).toBe(`calc(${slot} * ${step})`);
			expect(marker?.textContent).toBe("");
		}
	});

	it("renders each multi-digit page number once during page transitions", async () => {
		mockMotion(false);
		await render(<Pagination defaultPage={5_000} pageCount={10_000} />);

		expectSingleNumbers();
		for (const direction of ["Next page", "Next page", "Previous page"]) {
			await click(buttonNamed(direction));
			expectSingleNumbers();
		}
		expect(currentPage()).toBe(5_001);
	});

	it("animates a moving page window and cancels motion on page changes and removal", async () => {
		const { animations } = mockMotion(false);
		await render(<Pagination defaultPage={2} pageCount={20} />);
		await click(buttonNamed("Next page"));
		expect(currentPage()).toBe(3);
		expect(pages()).toEqual([1, 2, 3, 20]);
		expect(animations).toHaveLength(0);

		await click(buttonNamed("Next page"));
		expect(currentPage()).toBe(4);
		expect(pages()).toEqual([1, 4, 20]);
		expect(animations).toHaveLength(1);
		expect(animations[0]?.element).toBe(
			container.querySelector(".cline-ui-pagination__track"),
		);
		await click(buttonNamed("Next page"));
		expect(animations).toHaveLength(2);
		expect(animations[0]?.cancel).toHaveBeenCalledOnce();
		expect(animations[1]?.cancel).not.toHaveBeenCalled();
		await render(null);
		for (const animation of animations) {
			expect(animation.cancel).toHaveBeenCalledOnce();
		}
	});

	it.each([
		["unchanged", 7, "Next page", "-98.5px", "-98.5px", 9, "3"],
		["advanced", 8, "Next page", "-138px", "-98px", 10, "4"],
		["reversed", 10, "Previous page", "-138px", "-178px", 10, "4"],
	] as const)("rebases an interrupted slide when the overscan origin is %s", async (_, startPage, direction, sampled, expected, page, firstPage) => {
		const { animations } = mockMotion(false);
		await render(
			<Pagination defaultPage={startPage} pageCount={20} visiblePages={9} />,
		);
		await click(buttonNamed("Next page"));
		expect(animations).toHaveLength(1);
		const previousAnimations = [...animations];
		const getStyle = mockTrackOffset(sampled);
		await click(buttonNamed(direction));
		expect(currentPage()).toBe(page);

		const replacements = animations.slice(previousAnimations.length);
		expect(replacements).toHaveLength(1);
		for (const animation of replacements) {
			const step = (animation.element as HTMLElement).style.gridAutoColumns;
			expect(animation.keyframes).toEqual([
				{ translate: expected },
				{ translate: `calc(-4 * ${step})` },
			]);
			expect(animation.element.firstElementChild?.textContent).toBe(firstPage);
		}
		for (const animation of previousAnimations) {
			expect(animation.cancel).toHaveBeenCalledOnce();
			expect(getStyle.mock.invocationCallOrder[0]).toBeLessThan(
				animation.cancel.mock.invocationCallOrder[0] as number,
			);
		}
	});

	it("finishes an interrupted strip slide when the selection approaches the end of the results", async () => {
		const { animations } = mockMotion(false);
		await render(
			<Pagination defaultPage={5} pageCount={10} visiblePages={9} />,
		);
		await click(buttonNamed("Next page"));
		expect(pages()).toEqual([1, 4, 5, 6, 7, 8, 9, 10]);
		const previousAnimations = [...animations];
		mockTrackOffset("-24px");
		await click(buttonNamed("Next page"));
		expect(currentPage()).toBe(7);
		expect(pages()).toEqual([1, 4, 5, 6, 7, 8, 9, 10]);

		const replacements = animations.slice(previousAnimations.length);
		expect(replacements).toHaveLength(1);
		for (const animation of replacements) {
			const step = (animation.element as HTMLElement).style.gridAutoColumns;
			expect(animation.keyframes).toEqual([
				{ translate: "-24px" },
				{ translate: `calc(-1 * ${step})` },
			]);
		}
		for (const animation of previousAnimations) {
			expect(animation.cancel).toHaveBeenCalledOnce();
		}
	});

	it("snaps rather than showing a blank edge when rapid clicks outrun the overscan", async () => {
		const { animations } = mockMotion(false);
		await render(
			<Pagination defaultPage={5} pageCount={20} visiblePages={9} />,
		);
		await click(buttonNamed("Next page"));
		// Simulate clicks arriving before the previous frame has moved at all.
		mockTrackOffset("0px");
		for (let page = 7; page <= 9; page += 1) {
			await click(buttonNamed("Next page"));
			expect(currentPage()).toBe(page);
		}
		const previousCount = animations.length;
		await click(buttonNamed("Next page"));
		expect(currentPage()).toBe(10);
		expect(animations).toHaveLength(previousCount);
		expect(pages()).toEqual([1, 8, 9, 10, 11, 12, 20]);
		for (const track of container.querySelectorAll<HTMLElement>(
			".cline-ui-pagination__track",
		)) {
			expect(track.style.translate).toBe(
				`calc(-4 * ${track.style.gridAutoColumns})`,
			);
			expect(track.firstElementChild?.textContent).toBe("4");
		}
		for (const animation of animations) {
			expect(animation.cancel).toHaveBeenCalledOnce();
		}
	});

	it("snaps large jumps with a bounded strip and resumes sliding on the next adjacent page", async () => {
		const { animations } = mockMotion(false);
		const control = (page: number) => (
			<Pagination page={page} pageCount={1_000_000} visiblePages={9} />
		);
		await render(control(5));
		await render(control(6));
		expect(animations).toHaveLength(1);
		mockTrackOffset("-24px");

		await render(control(500_000));
		expect(animations).toHaveLength(1);
		expect(animations[0]?.cancel).toHaveBeenCalledOnce();
		expect(pages()).toEqual([
			1, 499_998, 499_999, 500_000, 500_001, 500_002, 1_000_000,
		]);
		expect(
			container.querySelector(".cline-ui-pagination__track")?.children.length,
		).toBeLessThanOrEqual(13);
		await render(control(500_000));
		expect(animations).toHaveLength(1);

		await render(control(500_001));
		expect(currentPage()).toBe(500_001);
		expect(animations).toHaveLength(2);
		const resumed = animations[1];
		const step = (resumed?.element as HTMLElement).style.gridAutoColumns;
		expect(resumed?.keyframes).toEqual([
			{ translate: `calc(-3 * ${step})` },
			{ translate: `calc(-4 * ${step})` },
		]);
	});

	it.each([
		{ pageCount: 9_999, nextPageCount: 10_000 },
		{ pageCount: 10_000, nextPageCount: 9_999 },
	])("snaps an interrupted slide when the page count changes from $pageCount to $nextPageCount", async ({
		pageCount,
		nextPageCount,
	}) => {
		const { animations } = mockMotion(false);
		await render(
			<Pagination defaultPage={5_000} pageCount={pageCount} visiblePages={9} />,
		);
		await click(buttonNamed("Next page"));
		expect(animations).toHaveLength(1);
		const track = animations[0]?.element as HTMLElement;
		const previousWidth = track.style.gridAutoColumns;
		mockTrackOffset("-138px");

		await render(<Pagination pageCount={nextPageCount} visiblePages={9} />);
		expect(currentPage()).toBe(5_001);
		expect(animations[0]?.cancel).toHaveBeenCalledOnce();
		expect(animations).toHaveLength(1);
		const width = track.style.gridAutoColumns;
		expect(width).not.toBe(previousWidth);
		expect(width).toBe(pageButton(5_001).style.inlineSize);
		expect(track.style.translate).toBe(`calc(-4 * ${width})`);

		await click(buttonNamed("Next page"));
		expect(currentPage()).toBe(5_002);
		expect(animations).toHaveLength(2);
		expect(animations[1]?.keyframes).toEqual([
			{ translate: `calc(-3 * ${width})` },
			{ translate: `calc(-4 * ${width})` },
		]);
	});

	it.each([
		{ visiblePages: 7, size: "xs" as const },
		{ visiblePages: 9, size: "sm" as const },
	])("cancels a slide when geometry changes to $visiblePages slots at size $size", async ({
		visiblePages,
		size,
	}) => {
		const { animations } = mockMotion(false);
		await render(
			<Pagination defaultPage={10} pageCount={20} visiblePages={9} />,
		);
		await click(buttonNamed("Next page"));
		mockTrackOffset("-138px");

		await render(
			<Pagination pageCount={20} visiblePages={visiblePages} size={size} />,
		);
		expect(currentPage()).toBe(11);
		expect(animations).toHaveLength(1);
		expect(animations[0]?.cancel).toHaveBeenCalledOnce();

		await click(buttonNamed("Next page"));
		expect(currentPage()).toBe(12);
		expect(animations).toHaveLength(2);
	});
});
