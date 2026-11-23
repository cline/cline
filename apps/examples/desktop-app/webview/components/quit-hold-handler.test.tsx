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
	vi.spyOn(document, "hasFocus").mockReturnValue(true);
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
	it("restores native quit on blur and requires holding again on focus", () => {
		expect(invoke).toHaveBeenLastCalledWith("set_quit_shortcut_native", {
			enabled: false,
		});
		press();
		advance(500);
		act(() => window.dispatchEvent(new Event("blur")));
		expect(invoke).toHaveBeenLastCalledWith("set_quit_shortcut_native", {
			enabled: true,
		});
		expect(container.querySelector("output")).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
		act(() => window.dispatchEvent(new Event("focus")));
		expect(invoke).toHaveBeenLastCalledWith("set_quit_shortcut_native", {
			enabled: false,
		});
		press();
		advance(500);
		press(true);
		expectNoQuit();
	});

	it("keeps native quit when mounted without focus", async () => {
		await act(async () => root.unmount());
		vi.mocked(document.hasFocus).mockReturnValue(false);
		root = createRoot(container);
		await act(async () => {
			root.render(<QuitHoldHandler bindings={defaultKeybindings(true)} />);
		});
		expect(invoke).toHaveBeenLastCalledWith("set_quit_shortcut_native", {
			enabled: true,
		});
		act(() => window.dispatchEvent(new Event("focus")));
		expect(invoke).toHaveBeenLastCalledWith("set_quit_shortcut_native", {
			enabled: false,
		});
	});

	it("keeps an immediate native binding enabled across focus changes", async () => {
		await act(async () => {
			root.render(
				<QuitHoldHandler
					bindings={{
						...defaultKeybindings(true),
						quit: { key: "Mod+Q", holdMs: 0 },
					}}
				/>,
			);
		});
		invoke.mockClear();
		act(() => window.dispatchEvent(new Event("blur")));
		act(() => window.dispatchEvent(new Event("focus")));
		expect(invoke.mock.calls).toEqual([
			["set_quit_shortcut_native", { enabled: true }],
			["set_quit_shortcut_native", { enabled: true }],
		]);
	});

	it("restores native quit and removes focus listeners on unmount", async () => {
		await act(async () => root.unmount());
		expect(invoke).toHaveBeenLastCalledWith("set_quit_shortcut_native", {
			enabled: true,
		});
		invoke.mockClear();
		act(() => window.dispatchEvent(new Event("focus")));
		expect(invoke).not.toHaveBeenCalled();
		root = createRoot(container);
	});

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

	it("keeps the quit shortcut from reaching input handlers", () => {
		const input = document.createElement("textarea");
		container.appendChild(input);
		const onInputKeyDown = vi.fn();
		input.addEventListener("keydown", onInputKeyDown);
		act(() => {
			input.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					key: "q",
					metaKey: true,
				}),
			);
		});
		expect(onInputKeyDown).not.toHaveBeenCalled();
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
