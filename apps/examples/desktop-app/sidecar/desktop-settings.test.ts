import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
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
	writeDesktopSettings,
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

function writeRaw(contents: string): void {
	mkdirSync(dirname(resolveDesktopSettingsPath()), { recursive: true });
	writeFileSync(resolveDesktopSettingsPath(), contents);
}

describe("desktop settings store", () => {
	it("defaults cloud agents to on when the file is missing", () => {
		expect(readDesktopSettings()).toEqual({ cloudAgentsEnabled: true });
	});

	it("stores preferences under the desktop client settings directory", () => {
		expect(
			resolveDesktopSettingsPath().endsWith(
				join("settings", "clients", "desktop", "preferences.json"),
			),
		).toBe(true);
	});

	it("round-trips the cloud agents preference", () => {
		expect(writeDesktopSettings({ cloudAgentsEnabled: false })).toEqual({
			cloudAgentsEnabled: false,
		});
		expect(readDesktopSettings()).toEqual({ cloudAgentsEnabled: false });
		expect(
			JSON.parse(readFileSync(resolveDesktopSettingsPath(), "utf8")),
		).toEqual({ version: 1, cloudAgentsEnabled: false });
		writeDesktopSettings({ cloudAgentsEnabled: true });
		expect(readDesktopSettings()).toEqual({ cloudAgentsEnabled: true });
	});

	it("preserves unknown keys when writing", () => {
		writeRaw(JSON.stringify({ version: 1, futureSetting: { a: 1 } }));
		writeDesktopSettings({ cloudAgentsEnabled: false });
		expect(
			JSON.parse(readFileSync(resolveDesktopSettingsPath(), "utf8")),
		).toEqual({
			version: 1,
			futureSetting: { a: 1 },
			cloudAgentsEnabled: false,
		});
	});

	it.each([
		["a corrupt file", "{not json"],
		["a non-object file", "[true]"],
		["a non-boolean value", JSON.stringify({ cloudAgentsEnabled: "no" })],
	])("reads %s as the default", (_name, contents) => {
		writeRaw(contents);
		expect(readDesktopSettings()).toEqual({ cloudAgentsEnabled: true });
	});

	it("recovers from a corrupt file on the next write", () => {
		writeRaw("{not json");
		writeDesktopSettings({ cloudAgentsEnabled: false });
		expect(readDesktopSettings()).toEqual({ cloudAgentsEnabled: false });
	});

	it("reads a file with a leading byte order mark", () => {
		writeRaw(`\uFEFF${JSON.stringify({ cloudAgentsEnabled: false })}`);
		expect(readDesktopSettings()).toEqual({ cloudAgentsEnabled: false });
	});

	it("sees hand edits without a restart", () => {
		writeDesktopSettings({ cloudAgentsEnabled: false });
		writeRaw(JSON.stringify({ version: 1, cloudAgentsEnabled: true }));
		expect(readDesktopSettings()).toEqual({ cloudAgentsEnabled: true });
	});

	it("leaves no temp file behind after a write", () => {
		writeDesktopSettings({ cloudAgentsEnabled: false });
		expect(readdirSync(dirname(resolveDesktopSettingsPath()))).toEqual([
			"preferences.json",
		]);
	});
});
