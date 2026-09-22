import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

/**
 * Locales the desktop app ships catalogs for. `system` means "resolve from the
 * OS language list". Keep in sync with `webview/lib/locale.ts` and the
 * `sdk/packages/i18n/locales/*` catalogs.
 */
const LOCALE_PREFERENCES = new Set(["system", "en", "zh-Hans"]);

/** Desktop-only preferences kept separate from strict shared global settings. */
export type DesktopSettings = {
	/** Opt-in gate for cloud sessions while the feature is in preview. */
	cloudSessionsEnabled: boolean;
	/** UI language: "system" resolves from the OS at startup. */
	language?: string;
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
			language:
				typeof parsed.language === "string" &&
				LOCALE_PREFERENCES.has(parsed.language)
					? parsed.language
					: undefined,
		};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function writeDesktopSettings(settings: DesktopSettings): void {
	const filePath = resolveDesktopSettingsPath();
	mkdirSync(dirname(filePath), { recursive: true });
	// Avoid leaving torn settings if the process exits mid-write.
	const tempPath = `${filePath}.${process.pid}.tmp`;
	writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	renameSync(tempPath, filePath);
}

export function setCloudSessionsEnabled(enabled: boolean): DesktopSettings {
	const next = { ...readDesktopSettings(), cloudSessionsEnabled: enabled };
	writeDesktopSettings(next);
	return next;
}

/** Persist the UI language preference. Unknown values are ignored. */
export function setLanguage(language: string): DesktopSettings {
	if (!LOCALE_PREFERENCES.has(language)) {
		throw new Error(
			`unsupported language preference: ${language} (expected one of ${[...LOCALE_PREFERENCES].join(", ")})`,
		);
	}
	const next = { ...readDesktopSettings(), language };
	writeDesktopSettings(next);
	return next;
}
