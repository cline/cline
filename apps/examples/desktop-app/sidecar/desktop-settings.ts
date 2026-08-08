import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

/**
 * Desktop-app-only preferences.
 *
 * These are kept out of the shared `global-settings.json` on purpose: that
 * file is parsed with a strict schema by every Cline app, and an older CLI
 * writing settings would silently strip fields it does not know about.
 */
export type DesktopSettings = {
	/** Opt-in gate for cloud sessions while the feature is in preview. */
	cloudSessionsEnabled: boolean;
};

const DEFAULT_SETTINGS: DesktopSettings = {
	cloudSessionsEnabled: false,
};

export function resolveDesktopSettingsPath(): string {
	return join(resolveClineDataDir(), "settings", "code-settings.json");
}

export function readDesktopSettings(): DesktopSettings {
	let raw: string;
	try {
		raw = readFileSync(resolveDesktopSettingsPath(), "utf8");
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return {
			cloudSessionsEnabled: parsed.cloudSessionsEnabled === true,
		};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function writeDesktopSettings(settings: DesktopSettings): void {
	const filePath = resolveDesktopSettingsPath();
	mkdirSync(dirname(filePath), { recursive: true });
	// Write-then-rename keeps the file whole if two app instances race or the
	// process dies mid-write; a torn JSON file would silently reset settings.
	const tempPath = `${filePath}.${process.pid}.tmp`;
	writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	renameSync(tempPath, filePath);
}

export function setCloudSessionsEnabled(enabled: boolean): DesktopSettings {
	const next = { ...readDesktopSettings(), cloudSessionsEnabled: enabled };
	writeDesktopSettings(next);
	return next;
}
