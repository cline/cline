// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTextareaAutosize } from "./use-textarea-autosize";

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
}

let container: HTMLDivElement;
let root: Root;

function Harness({
	show,
	value = "",
	version = 0,
}: {
	show: boolean;
	value?: string;
	version?: number;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	useTextareaAutosize(ref, value);
	return show ? (
		<textarea key={version} ref={ref} value={value} readOnly />
	) : null;
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	ResizeObserverStub.instances = [];
	vi.stubGlobal("CSS", { supports: vi.fn(() => false) });
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	vi.spyOn(
		HTMLTextAreaElement.prototype,
		"scrollHeight",
		"get",
	).mockReturnValue(40);
	vi.spyOn(
		HTMLTextAreaElement.prototype,
		"offsetHeight",
		"get",
	).mockReturnValue(22);
	vi.spyOn(
		HTMLTextAreaElement.prototype,
		"clientHeight",
		"get",
	).mockReturnValue(20);
	vi.spyOn(HTMLTextAreaElement.prototype, "offsetWidth", "get").mockReturnValue(
		300,
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

it("sizes a textarea that mounts after the hook with an unchanged value", async () => {
	await act(async () => root.render(<Harness show={false} />));
	expect(ResizeObserverStub.instances).toHaveLength(0);

	await act(async () => root.render(<Harness show />));
	const textarea = container.querySelector("textarea");
	if (!textarea) throw new Error("Missing textarea");
	expect(textarea.style.height).toBe("42px");
	expect(ResizeObserverStub.instances[0].observed.has(textarea)).toBe(true);
});

it("disconnects from a replaced textarea and observes the new node", async () => {
	await act(async () => root.render(<Harness show version={0} value="same" />));
	const first = container.querySelector("textarea");
	const firstObserver = ResizeObserverStub.instances[0];

	await act(async () => root.render(<Harness show version={1} value="same" />));
	const replacement = container.querySelector("textarea");
	if (!first || !replacement) throw new Error("Missing textarea");
	expect(replacement).not.toBe(first);
	expect(firstObserver.disconnect).toHaveBeenCalledOnce();
	expect(ResizeObserverStub.instances[1].observed.has(replacement)).toBe(true);
});
