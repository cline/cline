// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useScrollHeaderFade } from "./use-scroll-header-fade";

class ResizeObserverStub {
	static instances: ResizeObserverStub[] = [];
	readonly observed = new Set<Element>();
	readonly disconnect = vi.fn();
	constructor(readonly callback: ResizeObserverCallback) {
		ResizeObserverStub.instances.push(this);
	}
	observe(target: Element) {
		this.observed.add(target);
	}
	resize() {
		this.callback([], this as unknown as ResizeObserver);
	}
}

let container: HTMLDivElement;
let root: Root;
let headerTop: number;

function Harness({
	enabled = true,
	show = true,
	version = 0,
}: {
	enabled?: boolean;
	show?: boolean;
	version?: number;
}) {
	const headerRef = useRef<HTMLElement>(null);
	useScrollHeaderFade(headerRef, enabled);
	return (
		<div data-slot="scroll-area-viewport">
			{show ? (
				<header
					key={version}
					ref={headerRef}
					style={{ position: "sticky", top: 60 }}
				>
					Section
				</header>
			) : null}
		</div>
	);
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	ResizeObserverStub.instances = [];
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	headerTop = 80;
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			return new DOMRect(
				0,
				this.tagName === "HEADER" ? headerTop : 20,
				600,
				60,
			);
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

async function render(enabled = true, show = true, version = 0) {
	await act(async () =>
		root.render(<Harness enabled={enabled} show={show} version={version} />),
	);
	const header = container.querySelector("header");
	const viewport = container.querySelector<HTMLElement>(
		'[data-slot="scroll-area-viewport"]',
	);
	if (!viewport) throw new Error("Missing scroll viewport fixture");
	return { header, viewport };
}

async function scroll(viewport: HTMLElement, top: number) {
	await act(async () => {
		viewport.scrollTop = top;
		viewport.dispatchEvent(new Event("scroll"));
	});
}

it("fades only while a scrolled header is pinned to its viewport edge", async () => {
	const { header, viewport } = await render();
	if (!header) throw new Error("Missing scroll header fixture");
	expect(header.dataset.scrollFade).toBe("false");

	headerTop = 120;
	await scroll(viewport, 40);
	expect(header.dataset.scrollFade).toBe("false");

	headerTop = 80;
	await scroll(viewport, 80);
	expect(header.dataset.scrollFade).toBe("true");

	headerTop = 60;
	await scroll(viewport, 100);
	expect(header.dataset.scrollFade).toBe("false");

	headerTop = 80;
	await scroll(viewport, 0);
	expect(header.dataset.scrollFade).toBe("false");
});

it("updates pinning after layout changes without another scroll", async () => {
	const { header, viewport } = await render();
	if (!header) throw new Error("Missing scroll header fixture");
	await scroll(viewport, 80);
	expect(header.dataset.scrollFade).toBe("true");
	expect(ResizeObserverStub.instances[0].observed).toEqual(
		new Set([viewport, header, header.parentElement]),
	);

	headerTop = 100;
	await act(async () => ResizeObserverStub.instances[0].resize());
	expect(header.dataset.scrollFade).toBe("false");

	headerTop = 80;
	await act(async () => ResizeObserverStub.instances[0].resize());
	expect(header.dataset.scrollFade).toBe("true");
});

it("cleans up the fade and subscriptions when disabled or unmounted", async () => {
	const { header, viewport } = await render(false);
	if (!header) throw new Error("Missing scroll header fixture");
	await scroll(viewport, 80);
	expect(header.dataset.scrollFade).toBeUndefined();
	expect(ResizeObserverStub.instances).toHaveLength(0);

	await render();
	expect(header.dataset.scrollFade).toBe("true");
	const observer = ResizeObserverStub.instances[0];
	await render(false);
	expect(observer.disconnect).toHaveBeenCalledOnce();
	await scroll(viewport, 100);
	expect(header.dataset.scrollFade).toBeUndefined();

	await render();
	expect(header.dataset.scrollFade).toBe("true");
	await act(async () => root.render(null));
	expect(ResizeObserverStub.instances[1].disconnect).toHaveBeenCalledOnce();
	expect(header.dataset.scrollFade).toBeUndefined();
	await scroll(viewport, 120);
	expect(header.dataset.scrollFade).toBeUndefined();
});

it("subscribes when a header mounts late and follows replacement nodes", async () => {
	const { viewport } = await render(true, false);
	expect(ResizeObserverStub.instances).toHaveLength(0);

	const { header: first } = await render(true, true);
	if (!first) throw new Error("Missing first header");
	expect(first.dataset.scrollFade).toBe("false");
	const firstObserver = ResizeObserverStub.instances[0];
	expect(firstObserver.observed.has(first)).toBe(true);

	const { header: replacement } = await render(true, true, 1);
	if (!replacement) throw new Error("Missing replacement header");
	expect(replacement).not.toBe(first);
	expect(firstObserver.disconnect).toHaveBeenCalledOnce();
	expect(ResizeObserverStub.instances[1].observed.has(replacement)).toBe(true);

	await scroll(viewport, 80);
	expect(replacement.dataset.scrollFade).toBe("true");
});
