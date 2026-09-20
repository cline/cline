import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	readDesktopSettings,
	resolveDesktopSettingsPath,
	setCloudSessionsEnabled,
	setKeepAwakeEnabled,
} from "./desktop-settings";

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-desktop-settings-"));
	process.env.CLINE_DATA_DIR = dataDir;
});

afterEach(() => {
	delete process.env.CLINE_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
});

const DEFAULTS = { cloudSessionsEnabled: false, keepAwakeEnabled: true };

describe("desktop settings", () => {
	it("defaults cloud sessions to off and keep-awake to on", () => {
		expect(readDesktopSettings()).toEqual(DEFAULTS);
	});

	it("persists the cloud sessions opt-in and reads it back", () => {
		expect(setCloudSessionsEnabled(true)).toEqual({
			...DEFAULTS,
			cloudSessionsEnabled: true,
		});
		expect(readDesktopSettings()).toEqual({
			...DEFAULTS,
			cloudSessionsEnabled: true,
		});
		expect(resolveDesktopSettingsPath().endsWith("code-settings.json")).toBe(
			true,
		);
		expect(
			JSON.parse(readFileSync(resolveDesktopSettingsPath(), "utf8")),
		).toMatchObject({ cloudSessionsEnabled: true });
		expect(setCloudSessionsEnabled(false)).toEqual(DEFAULTS);
		expect(readDesktopSettings()).toEqual(DEFAULTS);
	});

	it("persists the keep-awake opt-out independently of cloud sessions", () => {
		setCloudSessionsEnabled(true);

		expect(setKeepAwakeEnabled(false)).toEqual({
			cloudSessionsEnabled: true,
			keepAwakeEnabled: false,
		});
		expect(readDesktopSettings()).toEqual({
			cloudSessionsEnabled: true,
			keepAwakeEnabled: false,
		});
		// Settings written before the key existed keep the default.
		writeFileSync(
			resolveDesktopSettingsPath(),
			JSON.stringify({ cloudSessionsEnabled: true }),
			"utf8",
		);
		expect(readDesktopSettings()).toEqual({
			cloudSessionsEnabled: true,
			keepAwakeEnabled: true,
		});
	});

	it("treats malformed files and non-boolean values as the defaults", () => {
		mkdirSync(dirname(resolveDesktopSettingsPath()), { recursive: true });
		writeFileSync(resolveDesktopSettingsPath(), "{not json", "utf8");
		expect(readDesktopSettings()).toEqual(DEFAULTS);
		writeFileSync(
			resolveDesktopSettingsPath(),
			JSON.stringify({ cloudSessionsEnabled: "yes", keepAwakeEnabled: "yes" }),
			"utf8",
		);
		expect(readDesktopSettings()).toEqual(DEFAULTS);
	});
});
