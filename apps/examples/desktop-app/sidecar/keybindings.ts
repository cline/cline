import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

/**
 * One user-configurable shortcut. `key` is an accelerator such as "Mod+N"
 * ("Mod" is Cmd on macOS, Ctrl elsewhere); an empty string unbinds the action.
 * `holdMs` > 0 means the shortcut only fires after being held that long.
 */
export type KeybindingEntry = {
	key: string;
	holdMs?: number;
};

export type KeybindingsFile = {
	version: 1;
	bindings: Record<string, KeybindingEntry>;
};

const MAX_BINDINGS = 128;
const MAX_KEY_LENGTH = 64;
const MAX_HOLD_MS = 5_000;

export function resolveKeybindingsPath(): string {
	return join(
		resolveClineDataDir(),
		"settings",
		"clients",
		"desktop",
		"keybindings.json",
	);
}

/** Drops anything malformed so a hand-edited file can never break the app. */
export function sanitizeKeybindings(value: unknown): KeybindingsFile {
	const bindings: Record<string, KeybindingEntry> = {};
	const raw =
		value && typeof value === "object"
			? (value as { bindings?: unknown }).bindings
			: undefined;
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		for (const [id, entry] of Object.entries(raw).slice(0, MAX_BINDINGS)) {
			if (!entry || typeof entry !== "object") continue;
			const { key, holdMs } = entry as { key?: unknown; holdMs?: unknown };
			if (typeof key !== "string" || key.length > MAX_KEY_LENGTH) continue;
			const next: KeybindingEntry = { key: key.trim() };
			if (typeof holdMs === "number" && Number.isFinite(holdMs) && holdMs > 0) {
				next.holdMs = Math.min(Math.round(holdMs), MAX_HOLD_MS);
			}
			bindings[id] = next;
		}
	}
	return { version: 1, bindings };
}

export function readKeybindings(): KeybindingsFile {
	try {
		return sanitizeKeybindings(
			JSON.parse(readFileSync(resolveKeybindingsPath(), "utf8")),
		);
	} catch {
		return { version: 1, bindings: {} };
	}
}

export function writeKeybindings(value: unknown): KeybindingsFile {
	const next = sanitizeKeybindings(value);
	const filePath = resolveKeybindingsPath();
	mkdirSync(dirname(filePath), { recursive: true });
	// Avoid leaving a torn file if the process exits mid-write.
	const tempPath = `${filePath}.${process.pid}.tmp`;
	writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	renameSync(tempPath, filePath);
	return next;
}
