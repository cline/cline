import { describe, expect, it } from "vitest";
import {
	hardenWindowsExecutableLookup,
	NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH,
} from "./windows-executable-lookup";

describe("hardenWindowsExecutableLookup", () => {
	it("defines the switch for a Windows process that lacks it", () => {
		const env: Record<string, string | undefined> = { Path: "C:\\tools" };
		expect(hardenWindowsExecutableLookup({ platform: "win32", env })).toBe(
			true,
		);
		expect(env).toEqual({
			Path: "C:\\tools",
			[NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH]: "1",
		});
	});

	it("leaves an existing value alone in any spelling, since only existence counts", () => {
		for (const existing of [
			{ NoDefaultCurrentDirectoryInExePath: "0" },
			{ NODEFAULTCURRENTDIRECTORYINEXEPATH: "" },
		]) {
			const env: Record<string, string | undefined> = { ...existing };
			expect(hardenWindowsExecutableLookup({ platform: "win32", env })).toBe(
				true,
			);
			expect(env).toEqual(existing);
		}
	});

	it("does nothing on other platforms", () => {
		for (const platform of ["darwin", "linux"] as const) {
			const env: Record<string, string | undefined> = {};
			expect(hardenWindowsExecutableLookup({ platform, env })).toBe(false);
			expect(env).toEqual({});
		}
	});
});
