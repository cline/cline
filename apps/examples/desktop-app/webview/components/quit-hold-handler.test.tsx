// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultKeybindings } from "@/lib/keybindings";
import { QuitHoldHandler } from "./quit-hold-handler";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	isTauriAvailable: () => true,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
	vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
	invoke.mockReset().mockResolvedValue(undefined);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root.render(<QuitHoldHandler bindings={defaultKeybindings(true)} />);
	});
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function press(repeat = false) {
	act(() => {
		window.dispatchEvent(
			new KeyboardEvent("keydown", { key: "q", metaKey: true, repeat }),
		);
	});
}

function advance(ms: number) {
	act(() => vi.advanceTimersByTime(ms));
}

function expectNoQuit() {
	expect(
		invoke.mock.calls.filter(([command]) => command === "quit_app"),
	).toHaveLength(0);
}

describe("QuitHoldHandler", () => {
	it.each([
		false,
		true,
	])("requires a full new hold after a second press (first press repeated: %s)", (firstPressRepeated) => {
		press();
		advance(500);
		if (firstPressRepeated) press(true);
		advance(200);
		// macOS omits Q's keyup while Cmd remains held.
		press();
		expect(vi.getTimerCount()).toBe(1);
		expect(
			container.querySelector<HTMLElement>(".bg-primary")?.style.width,
		).toBe("0%");
		for (let elapsed = 200; elapsed <= 800; elapsed += 200) {
			advance(200);
			press(true);
			expectNoQuit();
		}
		advance(200);
		press(true);
		expect(
			invoke.mock.calls.filter(([command]) => command === "quit_app"),
		).toHaveLength(1);
		expect(container.querySelector("output")).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("does not quit when repeats stop before the hold threshold", () => {
		press();
		advance(500);
		press(true);
		advance(200);
		press(true);
		advance(200);
		press(true);
		advance(200);
		expectNoQuit();
		advance(200);
		expectNoQuit();
		expect(container.querySelector("output")).toBeNull();
	});
});
