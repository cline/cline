import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Desktop-app-only preferences. These are intentionally separate from the
 * shared global settings file (`~/.cline/data/settings/settings.json`) that
 * the CLI also reads: feature gates for the desktop shell should not leak
 * into other Cline clients.
 */
export type DesktopAppSettings = {
	/** Gates the Cloud Sessions surface (sidebar entry, cloud view). */
	cloudSessionsEnabled: boolean;
};

const DEFAULT_SETTINGS: DesktopAppSettings = {
	cloudSessionsEnabled: false,
};

export function desktopAppSettingsPath(): string {
	return (
		process.env.CLINE_DESKTOP_APP_SETTINGS_PATH?.trim() ||
		join(homedir(), ".cline", "data", "settings", "desktop-app-settings.json")
	);
}

export function readDesktopAppSettings(): DesktopAppSettings {
	const path = desktopAppSettingsPath();
	if (!existsSync(path)) {
		return { ...DEFAULT_SETTINGS };
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			unknown
		>;
		return {
			cloudSessionsEnabled:
				typeof parsed.cloudSessionsEnabled === "boolean"
					? parsed.cloudSessionsEnabled
					: DEFAULT_SETTINGS.cloudSessionsEnabled,
		};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function updateDesktopAppSettings(
	patch: Partial<DesktopAppSettings>,
): DesktopAppSettings {
	const next: DesktopAppSettings = {
		...readDesktopAppSettings(),
		...(typeof patch.cloudSessionsEnabled === "boolean"
			? { cloudSessionsEnabled: patch.cloudSessionsEnabled }
			: {}),
	};
	const path = desktopAppSettingsPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
	return next;
}
