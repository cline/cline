import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getInstallationInfo,
	PackageManager,
	withMinimumReleaseAgeBypass,
} from "./update";

const originalArgv = [...process.argv];
const originalWrapperPath = process.env.CLINE_WRAPPER_PATH;
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
			updateCommand: "npm update -g cline",
		});
	});

	it("uses the nightly tag when the current CLI version is nightly", () => {
		const wrapperPath = createTempFile("lib/node_modules/cline/bin/cline");
		process.env.CLINE_WRAPPER_PATH = wrapperPath;
		process.argv = ["bun", "/$bunfs/root/cline", "update", "--verbose"];

		expect(getInstallationInfo("1.2.3-nightly.456")).toEqual({
			packageManager: PackageManager.NPM,
			packageName: "cline",
			updateCommand: "npm update -g cline",
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

describe("withMinimumReleaseAgeBypass", () => {
	it("adds the package-manager-specific cooldown bypass", () => {
		expect(
			withMinimumReleaseAgeBypass("npm update -g cline", PackageManager.NPM)
				.command,
		).toBe("npm update -g cline --min-release-age=0");
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
