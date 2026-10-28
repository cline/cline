"use client";

import { useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";

/**
 * Keybindings are stored in `<data dir>/settings/clients/desktop/keybindings.json`
 * (managed by the sidecar). The file only needs to hold overrides: any action
 * missing from it falls back to `defaultKeybindings()`.
 */

export type KeybindingActionId =
	| "new-session"
	| "command-bar"
	| "open-settings"
	| "toggle-terminal"
	| "quit";

export type KeybindingEntry = {
	/** Accelerator such as "Mod+N". "Mod" is Cmd on macOS and Ctrl elsewhere. */
	key: string;
	/** When > 0 the shortcut only fires after being held this long. */
	holdMs?: number;
};

export type KeybindingsFile = {
	version: 1;
	bindings: Record<string, KeybindingEntry>;
};

export type KeybindingDefinition = {
	id: KeybindingActionId;
	label: string;
	description: string;
	/** Whether the shortcut can be configured to require holding the keys. */
	supportsHold: boolean;
};

export const KEYBINDING_DEFINITIONS: readonly KeybindingDefinition[] = [
	{
		id: "new-session",
		label: "New session",
		description: "Start a new session.",
		supportsHold: false,
	},
	{
		id: "command-bar",
		label: "Search sessions",
		description: "Open the session search bar.",
		supportsHold: false,
	},
	{
		id: "open-settings",
		label: "Open settings",
		description: "Open the Settings view.",
		supportsHold: false,
	},
	{
		id: "toggle-terminal",
		label: "Toggle terminal",
		description: "Show or hide the terminal panel.",
		supportsHold: false,
	},
	{
		id: "quit",
		label: "Quit",
		description:
			"Quit the app. Holding avoids quitting by accident; set the hold time to 0 for an immediate quit.",
		supportsHold: true,
	},
];

export const DEFAULT_QUIT_HOLD_MS = 1_000;
export const MAX_HOLD_MS = 5_000;

export function isMacPlatform(): boolean {
	return (
		typeof navigator !== "undefined" &&
		/mac/i.test(navigator.platform || navigator.userAgent)
	);
}

/** Defaults are platform dependent: Ctrl+Q is not a standard quit elsewhere. */
export function defaultKeybindings(
	mac: boolean = isMacPlatform(),
): Record<KeybindingActionId, KeybindingEntry> {
	return {
		"new-session": { key: "Mod+N" },
		"command-bar": { key: "Mod+P" },
		"open-settings": { key: "Mod+," },
		// Ctrl on every platform, as in VS Code: Cmd+` switches windows on macOS.
		"toggle-terminal": { key: "Ctrl+`" },
		quit: mac ? { key: "Mod+Q", holdMs: DEFAULT_QUIT_HOLD_MS } : { key: "" },
	};
}

export type ResolvedKeybindings = Record<KeybindingActionId, KeybindingEntry>;

export function resolveKeybindings(
	file: KeybindingsFile | null | undefined,
	mac: boolean = isMacPlatform(),
): ResolvedKeybindings {
	const resolved = defaultKeybindings(mac);
	for (const { id } of KEYBINDING_DEFINITIONS) {
		const override = file?.bindings?.[id];
		if (!override || typeof override.key !== "string") continue;
		const key = override.key.trim();
		// Invalid hand-edited shortcuts fall back to the action's default.
		if (key && !isAppShortcut(key)) continue;
		const next: KeybindingEntry = { key };
		if (typeof override.holdMs === "number" && override.holdMs > 0) {
			next.holdMs = Math.min(override.holdMs, MAX_HOLD_MS);
		}
		resolved[id] = next;
	}
	return resolved;
}

/** Serializes the full mapping so the JSON file documents every action. */
export function toKeybindingsFile(
	bindings: ResolvedKeybindings,
): KeybindingsFile {
	return { version: 1, bindings: { ...bindings } };
}

// --- Accelerator parsing / matching ------------------------------------------

type Accelerator = {
	mod: boolean;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	key: string;
};

const MODIFIER_TOKENS = new Set([
	"mod",
	"cmd",
	"command",
	"meta",
	"super",
	"ctrl",
	"control",
	"alt",
	"option",
	"shift",
]);

export function normalizeKeyName(key: string): string {
	const lower = key.toLowerCase();
	if (lower === " " || lower === "spacebar") return "space";
	if (lower === "esc") return "escape";
	return lower;
}

export function parseAccelerator(value: string): Accelerator | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (trimmed === "+") {
		return { mod: false, ctrl: false, alt: false, shift: false, key: "+" };
	}
	// "+" can be the key itself ("Mod++"), so split on "+" only between tokens.
	const tokens = trimmed.endsWith("+")
		? [...trimmed.slice(0, -2).split("+"), "+"]
		: trimmed.split("+");
	const accelerator: Accelerator = {
		mod: false,
		ctrl: false,
		alt: false,
		shift: false,
		key: "",
	};
	for (const raw of tokens) {
		const token = raw.trim();
		if (!token) return null;
		const lower = token.toLowerCase();
		if (MODIFIER_TOKENS.has(lower)) {
			if (lower === "mod" || lower === "cmd" || lower === "command") {
				accelerator.mod = true;
			} else if (lower === "ctrl" || lower === "control") {
				accelerator.ctrl = true;
			} else if (lower === "alt" || lower === "option") {
				accelerator.alt = true;
			} else if (lower === "shift") {
				accelerator.shift = true;
			} else {
				accelerator.mod = true;
			}
			continue;
		}
		if (accelerator.key) return null;
		accelerator.key = normalizeKeyName(token);
	}
	return accelerator.key ? accelerator : null;
}

/** App-wide shortcuts must not intercept plain typing or focus navigation. */
export function isAppShortcut(value: string): boolean {
	const parsed = parseAccelerator(value);
	return (
		parsed !== null &&
		(parsed.mod ||
			parsed.ctrl ||
			parsed.alt ||
			/^f([1-9]|1\d|2[0-4])$/.test(parsed.key))
	);
}

type KeyEventLike = Pick<
	KeyboardEvent,
	"key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

export function matchesAccelerator(
	event: KeyEventLike,
	accelerator: string,
	mac: boolean = isMacPlatform(),
): boolean {
	const parsed = parseAccelerator(accelerator);
	if (!parsed || !isAppShortcut(accelerator)) return false;
	// "Mod" is Cmd on macOS and Ctrl elsewhere; "Ctrl" is always Ctrl.
	const wantMeta = mac && parsed.mod;
	const wantCtrl = parsed.ctrl || (!mac && parsed.mod);
	if (event.metaKey !== wantMeta) return false;
	if (event.ctrlKey !== wantCtrl) return false;
	if (event.altKey !== parsed.alt) return false;
	// Shifted punctuation already reports a different `key` ("+" vs "="), so
	// shift is implied by the key there; everywhere else it must match, or
	// Mod+Enter would also fire for Mod+Shift+Enter.
	if (!isShiftedByKey(parsed.key) && event.shiftKey !== parsed.shift) {
		return false;
	}
	return normalizeKeyName(event.key) === parsed.key;
}

/** Single punctuation characters whose shifted form is a different key. */
function isShiftedByKey(key: string): boolean {
	return key.length === 1 && !/[a-z0-9]/.test(key);
}

/**
 * Platform-resolved identity of a shortcut, so aliases ("Cmd+N", "mod+n",
 * "Mod+N") compare equal. Returns null for an unbound or malformed value.
 */
export function canonicalAccelerator(
	accelerator: string,
	mac: boolean = isMacPlatform(),
): string | null {
	const parsed = parseAccelerator(accelerator);
	if (!parsed) return null;
	const meta = mac && parsed.mod;
	const ctrl = parsed.ctrl || (!mac && parsed.mod);
	const shift = parsed.shift && !isShiftedByKey(parsed.key);
	return [
		meta ? "meta" : "",
		ctrl ? "ctrl" : "",
		parsed.alt ? "alt" : "",
		shift ? "shift" : "",
		parsed.key,
	].join("+");
}

// --- Suspension --------------------------------------------------------------

// While a shortcut is being recorded the keys the user presses must not run
// their current action (holding the quit keys would quit the app). Every
// shortcut listener checks this before acting.
let suspensions = 0;

export function areShortcutsSuspended(): boolean {
	return suspensions > 0;
}

/** Suspends every shortcut until the returned release function is called. */
export function suspendShortcuts(): () => void {
	suspensions += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		suspensions -= 1;
	};
}

/** Builds an app shortcut, or null for bare modifiers or unsafe typing keys. */
export function acceleratorFromEvent(
	event: KeyEventLike,
	mac: boolean = isMacPlatform(),
): string | null {
	const key = normalizeKeyName(event.key);
	if (
		["meta", "control", "alt", "shift", "dead", "unidentified"].includes(key)
	) {
		return null;
	}
	const parts: string[] = [];
	if (mac ? event.metaKey : event.ctrlKey) parts.push("Mod");
	if (mac && event.ctrlKey) parts.push("Ctrl");
	if (event.altKey) parts.push("Alt");
	if (event.shiftKey) parts.push("Shift");
	parts.push(key.length === 1 ? key.toUpperCase() : titleCase(key));
	const accelerator = parts.join("+");
	return isAppShortcut(accelerator) ? accelerator : null;
}

function titleCase(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

const MAC_SYMBOLS: Record<string, string> = {
	mod: "⌘",
	ctrl: "⌃",
	alt: "⌥",
	shift: "⇧",
};

/** Display parts for one shortcut, e.g. ["⌘", "⇧", "K"], for rendering as Kbd keys. */
export function acceleratorKeys(
	accelerator: string,
	mac: boolean = isMacPlatform(),
): string[] {
	const parsed = parseAccelerator(accelerator);
	if (!parsed) return [];
	const key =
		parsed.key.length === 1 ? parsed.key.toUpperCase() : titleCase(parsed.key);
	const keys: string[] = [];
	if (mac) {
		if (parsed.ctrl) keys.push(MAC_SYMBOLS.ctrl);
		if (parsed.alt) keys.push(MAC_SYMBOLS.alt);
		if (parsed.shift) keys.push(MAC_SYMBOLS.shift);
		if (parsed.mod) keys.push(MAC_SYMBOLS.mod);
	} else {
		if (parsed.mod || parsed.ctrl) keys.push("Ctrl");
		if (parsed.alt) keys.push("Alt");
		if (parsed.shift) keys.push("Shift");
	}
	keys.push(key);
	return keys;
}

export function formatAccelerator(
	accelerator: string,
	mac: boolean = isMacPlatform(),
): string {
	const keys = acceleratorKeys(accelerator, mac);
	return keys.length ? keys.join(mac ? "" : "+") : "Unbound";
}

// --- Loading -----------------------------------------------------------------

export async function loadKeybindingsFile(): Promise<KeybindingsFile> {
	return desktopClient.invoke<KeybindingsFile>("get_keybindings");
}

export async function saveKeybindings(
	bindings: ResolvedKeybindings,
): Promise<KeybindingsFile> {
	return desktopClient.invoke<KeybindingsFile>("set_keybindings", {
		keybindings: toKeybindingsFile(bindings),
	});
}

/** Live keybindings; re-reads on change events and when the window refocuses. */
export function useKeybindings(): ResolvedKeybindings {
	const [bindings, setBindings] = useState<ResolvedKeybindings>(() =>
		defaultKeybindings(),
	);
	useEffect(() => {
		let cancelled = false;
		const refresh = () => {
			void loadKeybindingsFile()
				.then((file) => {
					if (!cancelled) setBindings(resolveKeybindings(file));
				})
				.catch(() => {
					// Keep the last known bindings (defaults until the sidecar is up).
				});
		};
		refresh();
		const unsubscribe = desktopClient.subscribe("keybindings_changed", (file) =>
			setBindings(resolveKeybindings(file as KeybindingsFile)),
		);
		// Picks up hand edits to keybindings.json.
		window.addEventListener("focus", refresh);
		return () => {
			cancelled = true;
			unsubscribe();
			window.removeEventListener("focus", refresh);
		};
	}, []);
	return bindings;
}
