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

describe("desktop settings", () => {
	it("defaults cloud sessions to off when no settings file exists", () => {
		expect(readDesktopSettings()).toEqual({ cloudSessionsEnabled: false });
	});

	it("persists the cloud sessions opt-in and reads it back", () => {
		expect(setCloudSessionsEnabled(true)).toEqual({
			cloudSessionsEnabled: true,
		});
		expect(readDesktopSettings()).toEqual({ cloudSessionsEnabled: true });
		expect(setCloudSessionsEnabled(false)).toEqual({
			cloudSessionsEnabled: false,
		});
		expect(readDesktopSettings()).toEqual({ cloudSessionsEnabled: false });
	});

	it("writes into the desktop-owned settings file, not global-settings", () => {
		setCloudSessionsEnabled(true);
		const raw = JSON.parse(
			readFileSync(resolveDesktopSettingsPath(), "utf8"),
		) as Record<string, unknown>;
		expect(resolveDesktopSettingsPath().endsWith("code-settings.json")).toBe(
			true,
		);
		expect(raw.cloudSessionsEnabled).toBe(true);
	});

	it("treats malformed files and non-boolean values as off", () => {
		mkdirSync(dirname(resolveDesktopSettingsPath()), { recursive: true });
		writeFileSync(resolveDesktopSettingsPath(), "{not json", "utf8");
		expect(readDesktopSettings()).toEqual({ cloudSessionsEnabled: false });
		writeFileSync(
			resolveDesktopSettingsPath(),
			JSON.stringify({ cloudSessionsEnabled: "yes" }),
			"utf8",
		);
		expect(readDesktopSettings()).toEqual({ cloudSessionsEnabled: false });
	});
});
