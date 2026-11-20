import { afterEach, describe, expect, it, vi } from "vitest";
import {
	acceleratorFromEvent,
	acceleratorKeys,
	areShortcutsSuspended,
	canonicalAccelerator,
	formatAccelerator,
	isAppShortcut,
	matchesAccelerator,
	resolveKeybindings,
	suspendShortcuts,
} from "./keybindings";

afterEach(() => vi.unstubAllGlobals());

const event = (init: Partial<KeyboardEvent> & { key: string }) => ({
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	...init,
});

describe("keybindings", () => {
	it.each([
		"N",
		"Tab",
		"Enter",
		"Space",
		"Shift+N",
		"Shift+Tab",
		"F25",
		"Mod+",
	])("rejects unsafe or malformed app shortcut %s, including in JSON", (key) => {
		expect(isAppShortcut(key)).toBe(false);
		expect(
			resolveKeybindings({ version: 1, bindings: { "new-session": { key } } })[
				"new-session"
			].key,
		).toBe("Mod+N");
		expect(matchesAccelerator(event({ key: "n" }), key)).toBe(false);
	});

	it.each([
		false,
		true,
	])("rejects plain typing and shift-only recording (mac=%s)", (mac) => {
		for (const key of ["n", "Tab", "Enter", " "]) {
			expect(acceleratorFromEvent(event({ key }), mac)).toBeNull();
			expect(
				acceleratorFromEvent(event({ key, shiftKey: true }), mac),
			).toBeNull();
		}
		for (const key of ["F1", "F12", "F24"]) {
			expect(acceleratorFromEvent(event({ key }), mac)).toBe(key);
			expect(matchesAccelerator(event({ key }), key, mac)).toBe(true);
		}
		for (const modifier of ["ctrlKey", "altKey", ...(mac ? ["metaKey"] : [])]) {
			const input = event({ key: "n", [modifier]: true });
			const recorded = acceleratorFromEvent(input, mac);
			expect(recorded).not.toBeNull();
			expect(matchesAccelerator(input, recorded as string, mac)).toBe(true);
		}
	});

	it.each([
		["MacIntel", "⇧⌘K", ["⇧", "⌘", "K"]],
		["Win32", "Ctrl+Shift+K", ["Ctrl", "Shift", "K"]],
		["Linux x86_64", "Ctrl+Shift+K", ["Ctrl", "Shift", "K"]],
	])("displays shortcuts for the user's OS (%s)", (platform, label, keys) => {
		vi.stubGlobal("navigator", { platform });
		expect(formatAccelerator("Mod+Shift+K")).toBe(label);
		expect(acceleratorKeys("Mod+Shift+K")).toEqual(keys);
	});

	it("preserves explicitly unbound shortcuts", () => {
		expect(
			resolveKeybindings({
				version: 1,
				bindings: { "new-session": { key: "" } },
			})["new-session"].key,
		).toBe("");
	});

	it("matches Mod as Cmd on macOS and Ctrl elsewhere", () => {
		expect(
			matchesAccelerator(event({ key: "n", metaKey: true }), "Mod+N", true),
		).toBe(true);
		expect(
			matchesAccelerator(event({ key: "n", ctrlKey: true }), "Mod+N", true),
		).toBe(false);
		expect(
			matchesAccelerator(event({ key: "n", ctrlKey: true }), "Mod+N", false),
		).toBe(true);
		expect(
			matchesAccelerator(event({ key: ",", metaKey: true }), "Mod+,", true),
		).toBe(true);
	});

	it("enforces shift on named keys but not on shifted punctuation", () => {
		const shiftEnter = event({ key: "Enter", metaKey: true, shiftKey: true });
		expect(matchesAccelerator(shiftEnter, "Mod+Enter", true)).toBe(false);
		expect(matchesAccelerator(shiftEnter, "Mod+Shift+Enter", true)).toBe(true);
		// "+" is already the shifted "=" key, so the shift state is implied.
		expect(
			matchesAccelerator(
				event({ key: "+", metaKey: true, shiftKey: true }),
				"Mod++",
				true,
			),
		).toBe(true);
	});

	it("treats aliases and case as the same shortcut", () => {
		expect(canonicalAccelerator("Cmd+N", true)).toBe(
			canonicalAccelerator("mod+n", true),
		);
		expect(canonicalAccelerator("Mod+N", true)).not.toBe(
			canonicalAccelerator("Mod+N", false),
		);
		expect(canonicalAccelerator("Ctrl+N", false)).toBe(
			canonicalAccelerator("Mod+N", false),
		);
		expect(canonicalAccelerator("", true)).toBeNull();
	});

	it("suspends shortcuts until every suspension is released", () => {
		expect(areShortcutsSuspended()).toBe(false);
		const first = suspendShortcuts();
		const second = suspendShortcuts();
		first();
		first(); // releasing twice must not undo the other suspension
		expect(areShortcutsSuspended()).toBe(true);
		second();
		expect(areShortcutsSuspended()).toBe(false);
	});

	it("never matches an unbound action", () => {
		expect(
			matchesAccelerator(event({ key: "q", metaKey: true }), "", true),
		).toBe(false);
	});

	it("round-trips recorded shortcuts", () => {
		const recorded = acceleratorFromEvent(
			event({ key: "k", metaKey: true, shiftKey: true }),
			true,
		);
		expect(recorded).toBe("Mod+Shift+K");
		expect(formatAccelerator(recorded as string, true)).toBe("⇧⌘K");
		expect(
			acceleratorFromEvent(event({ key: "Meta", metaKey: true }), true),
		).toBeNull();
	});

	it("defaults quit to hold-to-quit on macOS only", () => {
		expect(resolveKeybindings(null, true).quit).toEqual({
			key: "Mod+Q",
			holdMs: 1000,
		});
		expect(resolveKeybindings(null, false).quit.key).toBe("");
	});

	it("applies overrides from the file and ignores unknown actions", () => {
		const resolved = resolveKeybindings(
			{
				version: 1,
				bindings: {
					quit: { key: "Mod+Q", holdMs: 2000 },
					"new-session": { key: "Mod+T" },
					nope: { key: "x" },
				},
			},
			true,
		);
		expect(resolved.quit.holdMs).toBe(2000);
		expect(resolved["new-session"].key).toBe("Mod+T");
		expect("nope" in resolved).toBe(false);
	});
});
