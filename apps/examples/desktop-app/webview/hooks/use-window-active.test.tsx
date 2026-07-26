// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowActive } from "./use-window-active";

let container: HTMLDivElement;
let root: Root;

function Probe() {
	return <span data-testid="state">{String(useWindowActive())}</span>;
}

function readState(): string {
	return container.querySelector("[data-testid=state]")?.textContent ?? "";
}

function setEnvironment({
	hidden,
	focused,
}: {
	hidden: boolean;
	focused: boolean;
}) {
	Object.defineProperty(document, "hidden", {
		configurable: true,
		get: () => hidden,
	});
	vi.spyOn(document, "hasFocus").mockReturnValue(focused);
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("useWindowActive", () => {
	it("reports active for a visible, focused window", () => {
		setEnvironment({ hidden: false, focused: true });
		act(() => root.render(<Probe />));
		expect(readState()).toBe("true");
	});

	it("goes inactive when the window loses focus and recovers on focus", () => {
		setEnvironment({ hidden: false, focused: true });
		act(() => root.render(<Probe />));
		expect(readState()).toBe("true");

		setEnvironment({ hidden: false, focused: false });
		act(() => {
			window.dispatchEvent(new Event("blur"));
		});
		expect(readState()).toBe("false");

		setEnvironment({ hidden: false, focused: true });
		act(() => {
			window.dispatchEvent(new Event("focus"));
		});
		expect(readState()).toBe("true");
	});

	it("goes inactive when the document is hidden", () => {
		setEnvironment({ hidden: false, focused: true });
		act(() => root.render(<Probe />));

		setEnvironment({ hidden: true, focused: true });
		act(() => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(readState()).toBe("false");
	});

	it("corrects an already-backgrounded window on mount", () => {
		setEnvironment({ hidden: true, focused: false });
		act(() => root.render(<Probe />));
		expect(readState()).toBe("false");
	});

	it("stops listening after unmount", () => {
		setEnvironment({ hidden: false, focused: true });
		act(() => root.render(<Probe />));
		const removeSpy = vi.spyOn(window, "removeEventListener");
		act(() => root.unmount());
		expect(removeSpy).toHaveBeenCalledWith("blur", expect.any(Function));
		expect(removeSpy).toHaveBeenCalledWith("focus", expect.any(Function));
		// Re-created in afterEach's unmount; keep the shared teardown happy.
		root = createRoot(container);
	});
});
