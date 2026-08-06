import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	desktopAppSettingsPath,
	readDesktopAppSettings,
	updateDesktopAppSettings,
} from "./desktop-settings";

const originalPathOverride = process.env.CLINE_DESKTOP_APP_SETTINGS_PATH;
let tempDir: string | null = null;

function useTempSettingsFile(): string {
	tempDir = mkdtempSync(join(tmpdir(), "cline-desktop-settings-"));
	const path = join(tempDir, "desktop-app-settings.json");
	process.env.CLINE_DESKTOP_APP_SETTINGS_PATH = path;
	return path;
}

afterEach(() => {
	if (originalPathOverride === undefined) {
		delete process.env.CLINE_DESKTOP_APP_SETTINGS_PATH;
	} else {
		process.env.CLINE_DESKTOP_APP_SETTINGS_PATH = originalPathOverride;
	}
	if (tempDir) {
		rmSync(tempDir, { force: true, recursive: true });
		tempDir = null;
	}
});

describe("desktopAppSettingsPath", () => {
	it("prefers the env override", () => {
		const path = useTempSettingsFile();
		expect(desktopAppSettingsPath()).toBe(path);
	});
});

describe("readDesktopAppSettings", () => {
	it("returns defaults when no settings file exists", () => {
		useTempSettingsFile();
		expect(readDesktopAppSettings()).toEqual({ cloudSessionsEnabled: false });
	});

	it("returns defaults when the file is corrupt", () => {
		const path = useTempSettingsFile();
		writeFileSync(path, "{not json");
		expect(readDesktopAppSettings()).toEqual({ cloudSessionsEnabled: false });
	});

	it("ignores non-boolean values", () => {
		const path = useTempSettingsFile();
		writeFileSync(path, JSON.stringify({ cloudSessionsEnabled: "yes" }));
		expect(readDesktopAppSettings()).toEqual({ cloudSessionsEnabled: false });
	});
});

describe("updateDesktopAppSettings", () => {
	it("persists the toggle and reads it back", () => {
		const path = useTempSettingsFile();
		const updated = updateDesktopAppSettings({ cloudSessionsEnabled: true });
		expect(updated).toEqual({ cloudSessionsEnabled: true });
		expect(readDesktopAppSettings()).toEqual({ cloudSessionsEnabled: true });
		const raw = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			unknown
		>;
		expect(raw.cloudSessionsEnabled).toBe(true);
	});

	it("keeps existing values when the patch omits them", () => {
		useTempSettingsFile();
		updateDesktopAppSettings({ cloudSessionsEnabled: true });
		const unchanged = updateDesktopAppSettings({});
		expect(unchanged).toEqual({ cloudSessionsEnabled: true });
	});
});
