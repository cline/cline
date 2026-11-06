// @vitest-environment jsdom
import { Clock3 } from "lucide-react";
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetailList } from "../components/detail-list.js";
import { DetailListItem } from "../components/detail-list-item.js";

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
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("DetailListItem responsive layout", () => {
	let notifyResize: () => void;
	let observe: ReturnType<typeof vi.fn>;
	let disconnect: ReturnType<typeof vi.fn>;
	let originalFontSize: string;

	beforeEach(() => {
		originalFontSize = document.documentElement.style.fontSize;
		document.documentElement.style.fontSize = "16px";
		observe = vi.fn();
		disconnect = vi.fn();
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe = observe;
				disconnect = disconnect;
				constructor(callback: () => void) {
					notifyResize = callback;
				}
			},
		);
	});

	afterEach(() => {
		document.documentElement.style.fontSize = originalFontSize;
	});

	function getItem() {
		const item = container.querySelector<HTMLElement>(
			"[data-slot='detail-list-item']",
		);
		if (!item) throw new Error("Missing detail row");
		return item;
	}

	async function renderMeasuredRow(width: number, trailingWidth: number) {
		await render(
			<DetailListItem
				leadingIcon={Clock3}
				title="Project folder"
				description="Runs in this folder and uses its project settings."
				actions={<button type="button">Browse…</button>}
				style={{ columnGap: 24 }}
			/>,
		);
		const item = getItem();
		const trailing = item.querySelector<HTMLElement>(
			".cline-ui-detail-list-item__trailing",
		);
		if (!trailing) throw new Error("Missing trailing controls");
		const size = { width, trailingWidth };
		vi.spyOn(item, "clientWidth", "get").mockImplementation(() => size.width);
		vi.spyOn(trailing, "offsetWidth", "get").mockImplementation(
			() => size.trailingWidth,
		);
		await act(async () => notifyResize());
		return { item, trailing, size };
	}

	it("keeps a squeezed row stacked until both sides fit again", async () => {
		const { item, size } = await renderMeasuredRow(680, 384);
		expect(item.dataset.stacked).toBe("true");

		// Stacking gives the label the whole row; that must not undo the wrap.
		const title = item.querySelector("dt");
		if (!title) throw new Error("Missing detail title");
		vi.spyOn(title, "offsetWidth", "get").mockReturnValue(size.width);
		await act(async () => notifyResize());
		expect(item.dataset.stacked).toBe("true");

		size.width = 760;
		await act(async () => notifyResize());
		expect(item.hasAttribute("data-stacked")).toBe(false);

		await act(async () => root.render(null));
		expect(disconnect).toHaveBeenCalledOnce();
	});

	it("reflows when trailing controls grow or shrink without a container resize", async () => {
		const { item, trailing, size } = await renderMeasuredRow(680, 96);
		expect(observe).toHaveBeenCalledWith(item);
		expect(observe).toHaveBeenCalledWith(trailing);
		expect(item.hasAttribute("data-stacked")).toBe(false);

		size.trailingWidth = 384;
		await act(async () => notifyResize());
		expect(item.dataset.stacked).toBe("true");

		size.trailingWidth = 96;
		await act(async () => notifyResize());
		expect(item.hasAttribute("data-stacked")).toBe(false);
	});

	it("leaves declared column layouts to the list's responsive grid", async () => {
		await act(async () =>
			root.render(
				<DetailList columns={[{ key: "runs", label: "Runs" }]}>
					<DetailListItem
						title="Daily review"
						values={{ runs: 3 }}
						actions={<button type="button">Edit</button>}
					/>
				</DetailList>,
			),
		);
		const item = getItem();
		expect(item.dataset.layout).toBe("columns");
		expect(item.hasAttribute("data-stacked")).toBe(false);
		expect(observe).not.toHaveBeenCalled();
	});
});
async function render(node: ReactNode) {
	await act(async () => root.render(<DetailList>{node}</DetailList>));
}

describe("DetailListItem", () => {
	it("does not reserve trailing columns for empty composed slots", async () => {
		const empty = createElement(Fragment, null, [
			null,
			false,
			"",
			createElement(Fragment, null, false),
		]);
		await render(
			<DetailListItem
				title="Authentication"
				description="This server does not require credentials."
				trailingText={empty}
				actions={[]}
			/>,
		);
		expect(
			container.querySelector(".cline-ui-detail-list-item__trailing"),
		).toBeNull();
		expect(container.querySelector("dd")?.textContent).toBe(
			"This server does not require credentials.",
		);
	});

	it("renders an optional managed icon without adding to the row's accessible text", async () => {
		await render(
			<DetailListItem
				title="Schedule"
				leadingIcon={Clock3}
				description="Run this task automatically."
				trailingText="Weekdays at 9:00 AM"
			/>,
		);
		const icon = container.querySelector("svg");
		expect(icon?.getAttribute("aria-hidden")).toBe("true");
		expect(icon?.getAttribute("focusable")).toBe("false");
		expect(container.querySelector("dt")?.textContent).toBe("Schedule");
		expect(
			container.querySelector(".cline-ui-detail-list-item__description")
				?.textContent,
		).toBe("Run this task automatically.");
		expect(
			container.querySelector(".cline-ui-detail-list-item__trailing-text")
				?.textContent,
		).toBe("Weekdays at 9:00 AM");
	});

	it("omits empty descriptions while retaining the value and zero count", async () => {
		await render(
			<DetailListItem
				title="Usage"
				count={0}
				description=""
				trailingText={0}
			/>,
		);
		expect(
			container.querySelector(".cline-ui-detail-list-item__description"),
		).toBeNull();
		expect(
			container.querySelector("[data-slot='detail-list-item-count']")
				?.textContent,
		).toBe("0");
		expect(
			container.querySelector(".cline-ui-detail-list-item__trailing-text")
				?.textContent,
		).toBe("0");
	});

	it("preserves content supplied by an opaque component", async () => {
		function Value() {
			return <>Connected</>;
		}
		await render(<DetailListItem title="Status" trailingText={<Value />} />);
		expect(
			container.querySelector(".cline-ui-detail-list-item__trailing-text")
				?.textContent,
		).toBe("Connected");
	});
});
