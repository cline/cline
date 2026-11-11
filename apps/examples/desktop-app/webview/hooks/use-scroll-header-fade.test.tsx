// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useScrollHeaderFade } from "./use-scroll-header-fade";

class ResizeObserverStub {
	static instances: ResizeObserverStub[] = [];
	readonly disconnect = vi.fn();
	constructor(readonly callback: ResizeObserverCallback) {
		ResizeObserverStub.instances.push(this);
	}
	observe() {}
	resize() {
		this.callback([], this as unknown as ResizeObserver);
	}
}

let container: HTMLDivElement;
let root: Root;
let headerTop: number;

function Harness({ enabled = true }: { enabled?: boolean }) {
	const headerRef = useRef<HTMLElement>(null);
	useScrollHeaderFade(headerRef, enabled);
	return (
		<div data-radix-scroll-area-viewport="">
			<header ref={headerRef} style={{ position: "sticky", top: 60 }}>
				Section
			</header>
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

async function render(enabled = true) {
	await act(async () => root.render(<Harness enabled={enabled} />));
	const header = container.querySelector("header");
	const viewport = container.querySelector<HTMLElement>(
		"[data-radix-scroll-area-viewport]",
	);
	if (!header || !viewport) throw new Error("Missing scroll header fixture");
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
	await scroll(viewport, 80);
	expect(header.dataset.scrollFade).toBe("true");

	headerTop = 100;
	await act(async () => ResizeObserverStub.instances[0].resize());
	expect(header.dataset.scrollFade).toBe("false");

	headerTop = 80;
	await act(async () => ResizeObserverStub.instances[0].resize());
	expect(header.dataset.scrollFade).toBe("true");
});

it("cleans up the fade and subscriptions when disabled or unmounted", async () => {
	const { header, viewport } = await render(false);
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
