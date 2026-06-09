import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	autoUpdateOnStartup,
	checkForUpdates,
	getInstallationInfo,
	PackageManager,
	withMinimumReleaseAgeBypass,
} from "./update";

const originalArgv = [...process.argv];
const originalWrapperPath = process.env.CLINE_WRAPPER_PATH;
const originalGlobalSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH;
const originalIsDev = process.env.IS_DEV;
const originalNoAutoUpdate = process.env.CLINE_NO_AUTO_UPDATE;
const tempDirs: string[] = [];

function createFile(path: string): string {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "");
	return path;
}

function createTempFile(pathSuffix: string): string {
	const root = mkdtempSync(join(tmpdir(), "cline-update-test-"));
	tempDirs.push(root);
	return createFile(join(root, pathSuffix));
}

describe("getInstallationInfo", () => {
	afterEach(() => {
		process.argv = [...originalArgv];
		if (originalWrapperPath === undefined) {
			delete process.env.CLINE_WRAPPER_PATH;
		} else {
			process.env.CLINE_WRAPPER_PATH = originalWrapperPath;
		}
		if (originalGlobalSettingsPath === undefined) {
			delete process.env.CLINE_GLOBAL_SETTINGS_PATH;
		} else {
			process.env.CLINE_GLOBAL_SETTINGS_PATH = originalGlobalSettingsPath;
		}
		if (originalIsDev === undefined) {
			delete process.env.IS_DEV;
		} else {
			process.env.IS_DEV = originalIsDev;
		}
		if (originalNoAutoUpdate === undefined) {
			delete process.env.CLINE_NO_AUTO_UPDATE;
		} else {
			process.env.CLINE_NO_AUTO_UPDATE = originalNoAutoUpdate;
		}
		vi.restoreAllMocks();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("detects npm installs from the wrapper path passed to the compiled binary", () => {
		const wrapperPath = createTempFile("lib/node_modules/cline/bin/cline");
		process.env.CLINE_WRAPPER_PATH = wrapperPath;
		process.argv = ["bun", "/$bunfs/root/cline", "update", "--verbose"];

		expect(getInstallationInfo("1.2.3")).toEqual({
			packageManager: PackageManager.NPM,
			packageName: "cline",
			updateCommand: "npm update -g cline --tag latest",
		});
	});

	it("uses the nightly tag when the current CLI version is nightly", () => {
		const wrapperPath = createTempFile("lib/node_modules/cline/bin/cline");
		process.env.CLINE_WRAPPER_PATH = wrapperPath;
		process.argv = ["bun", "/$bunfs/root/cline", "update", "--verbose"];

		expect(getInstallationInfo("1.2.3-nightly.456")).toEqual({
			packageManager: PackageManager.NPM,
			packageName: "cline",
			updateCommand: "npm update -g cline --tag nightly",
		});
	});

	it("falls back to unknown when only Bun's virtual compiled path is available", () => {
		delete process.env.CLINE_WRAPPER_PATH;
		process.argv = ["bun", "/$bunfs/root/cline", "update", "--verbose"];

		expect(getInstallationInfo("1.2.3")).toEqual({
			packageManager: PackageManager.UNKNOWN,
			packageName: "cline",
		});
	});
});

describe("auto update settings", () => {
	afterEach(() => {
		process.argv = [...originalArgv];
		if (originalWrapperPath === undefined) {
			delete process.env.CLINE_WRAPPER_PATH;
		} else {
			process.env.CLINE_WRAPPER_PATH = originalWrapperPath;
		}
		if (originalGlobalSettingsPath === undefined) {
			delete process.env.CLINE_GLOBAL_SETTINGS_PATH;
		} else {
			process.env.CLINE_GLOBAL_SETTINGS_PATH = originalGlobalSettingsPath;
		}
		if (originalIsDev === undefined) {
			delete process.env.IS_DEV;
		} else {
			process.env.IS_DEV = originalIsDev;
		}
		if (originalNoAutoUpdate === undefined) {
			delete process.env.CLINE_NO_AUTO_UPDATE;
		} else {
			process.env.CLINE_NO_AUTO_UPDATE = originalNoAutoUpdate;
		}
		vi.restoreAllMocks();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips startup auto update when disabled globally", () => {
		const settingsPath = createTempFile("data/global-settings.json");
		writeFileSync(settingsPath, JSON.stringify({ autoUpdateEnabled: false }));
		process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;
		delete process.env.IS_DEV;
		delete process.env.CLINE_NO_AUTO_UPDATE;
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("should not fetch"));

		autoUpdateOnStartup();

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("still lets manual update checks run when startup auto update is disabled", async () => {
		const settingsPath = createTempFile("data/global-settings.json");
		writeFileSync(settingsPath, JSON.stringify({ autoUpdateEnabled: false }));
		process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;
		delete process.env.CLINE_NO_AUTO_UPDATE;
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ version: "0.0.0" }),
		} as Response);

		await checkForUpdates({ includeKanban: false });

		expect(fetchSpy).toHaveBeenCalled();
	});
});

describe("withMinimumReleaseAgeBypass", () => {
	it("adds the package-manager-specific cooldown bypass", () => {
		expect(
			withMinimumReleaseAgeBypass(
				"npm update -g cline --tag latest",
				PackageManager.NPM,
			).command,
		).toBe("npm update -g cline --tag latest --min-release-age=0");
		expect(
			withMinimumReleaseAgeBypass("bun add -g cline@latest", PackageManager.BUN)
				.command,
		).toBe("bun add -g cline@latest --minimum-release-age=0");
		expect(
			withMinimumReleaseAgeBypass(
				"yarn global add cline@latest",
				PackageManager.YARN,
			).command,
		).toBe("yarn global add cline@latest");
		expect(
			withMinimumReleaseAgeBypass(
				"yarn global add cline@latest",
				PackageManager.YARN,
			).env?.YARN_NPM_MINIMAL_AGE_GATE,
		).toBe("0");

		expect(
			withMinimumReleaseAgeBypass(
				"pnpm add -g cline@latest",
				PackageManager.PNPM,
			).env?.pnpm_config_minimum_release_age,
		).toBe("0");
	});
});
