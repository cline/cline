// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "../components/message-scroller.js";

let container: HTMLDivElement;
let root: Root;
const history = ["user-first", "answer-first", "user-second", "answer-second"];

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
	vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
		function (this: HTMLElement) {
			return container.querySelectorAll("[data-message-id]").length * 400;
		},
	);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			const rows = [...container.querySelectorAll("[data-message-id]")];
			const index = rows.indexOf(this);
			const top = index < 0 ? 0 : index * 400 - viewport().scrollTop;
			return {
				top,
				bottom: top + 400,
				height: 400,
				left: 0,
				right: 800,
				width: 800,
				x: 0,
				y: top,
				toJSON() {},
			};
		},
	);
	HTMLElement.prototype.scrollTo = vi.fn(function (
		this: HTMLElement,
		options?: ScrollToOptions | number,
		_y?: number,
	) {
		this.scrollTop =
			typeof options === "number" ? options : (options?.top ?? 0);
	});
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

function viewport() {
	const element = container.querySelector<HTMLElement>(
		'[data-slot="message-scroller-viewport"]',
	);
	if (!element) throw new Error("Missing transcript viewport");
	return element;
}

async function renderRows(rows: string[]) {
	await act(async () => {
		root.render(
			<MessageScrollerProvider
				autoScroll
				defaultScrollPosition="end"
				scrollMargin={24}
			>
				<MessageScroller>
					<MessageScrollerViewport>
						<MessageScrollerContent>
							{rows.map((id) => (
								<MessageScrollerItem
									key={id}
									messageId={id}
									scrollAnchor={id.startsWith("user-")}
								>
									{id}
								</MessageScrollerItem>
							))}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>,
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
	});
}

async function readAt(offset: number) {
	await act(async () => {
		viewport().dispatchEvent(
			new WheelEvent("wheel", { deltaY: -400, bubbles: true }),
		);
		viewport().scrollTop = offset;
		viewport().dispatchEvent(new Event("scroll"));
	});
}

describe("MessageScroller turn identity", () => {
	it.each([
		"prompt acknowledgment",
		"first output",
	])("keeps a saved transcript at the bottom during %s", async (transition) => {
		await renderRows([...history, "user-optimistic", "thinking"]);
		expect(viewport().scrollTop).toBe(2000);
		await renderRows([
			...history,
			transition === "prompt acknowledgment"
				? "user-confirmed"
				: "user-optimistic",
			transition === "first output" ? "answer-new" : "thinking",
		]);
		expect(viewport().scrollTop).toBe(2000);
	});

	it.each([
		"prompt acknowledgment",
		"first output",
	])("preserves a reader's position during %s after continuing a saved conversation", async (transition) => {
		await renderRows(history);
		expect(viewport().scrollTop).toBe(1200);
		await renderRows([...history, "user-optimistic", "thinking"]);
		expect(viewport().scrollTop).toBe(1512);
		await readAt(600);
		await renderRows([
			...history,
			transition === "prompt acknowledgment"
				? "user-confirmed"
				: "user-optimistic",
			transition === "first output" ? "answer-new" : "thinking",
		]);
		expect(viewport().scrollTop).toBe(600);
	});

	it("does not replay prepended history on later row replacement", async () => {
		await renderRows(history);
		await readAt(600);
		await renderRows(["user-older", "answer-older", ...history]);
		const restoredOffset = viewport().scrollTop;
		expect(restoredOffset).toBe(1400);
		await renderRows([
			"user-older",
			"answer-older",
			...history.slice(0, -1),
			"answer-replaced",
		]);
		expect(viewport().scrollTop).toBe(restoredOffset);
	});

	it("anchors subsequent submissions after acknowledgment and output replacement", async () => {
		await renderRows(history);
		await renderRows([...history, "user-optimistic", "thinking"]);
		expect(viewport().scrollTop).toBe(1512);
		await renderRows([...history, "user-confirmed", "thinking"]);
		expect(viewport().scrollTop).toBe(1512);
		await renderRows([...history, "user-confirmed", "answer-new"]);
		expect(viewport().scrollTop).toBe(1512);
		await renderRows([...history, "user-confirmed", "answer-new", "user-next"]);
		expect(viewport().scrollTop).toBe(2312);
	});
});

describe("MessageScrollerButton", () => {
	afterEach(() => vi.unstubAllGlobals());

	it.each([
		{ reducedMotion: false, behavior: "smooth" },
		{ reducedMotion: true, behavior: "auto" },
	])("scrolls to the end with $behavior when reduced motion is $reducedMotion", async ({
		reducedMotion,
		behavior,
	}) => {
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => ({ matches: reducedMotion })),
		);
		await renderRows(history);
		await readAt(0);
		const button = container.querySelector<HTMLButtonElement>(
			'[data-slot="message-scroller-button"]',
		);
		await act(async () => button?.click());
		expect(HTMLElement.prototype.scrollTo).toHaveBeenLastCalledWith({
			top: 1200,
			behavior,
		});
	});
});
