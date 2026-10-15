import { describe, expect, it } from "vitest";
import {
	acceleratorFromEvent,
	areShortcutsSuspended,
	canonicalAccelerator,
	formatAccelerator,
	matchesAccelerator,
	resolveKeybindings,
	suspendShortcuts,
} from "./keybindings";

const event = (init: Partial<KeyboardEvent> & { key: string }) => ({
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	...init,
});

describe("keybindings", () => {
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
