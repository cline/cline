import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getInstallationInfo, PackageManager } from "./update";

const originalArgv = [...process.argv];
const originalWrapperPath = process.env.CLITE_WRAPPER_PATH;
const tempDirs: string[] = [];

function createFile(path: string): string {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "");
	return path;
}

function createTempFile(pathSuffix: string): string {
	const root = mkdtempSync(join(tmpdir(), "clite-update-test-"));
	tempDirs.push(root);
	return createFile(join(root, pathSuffix));
}

describe("getInstallationInfo", () => {
	afterEach(() => {
		process.argv = [...originalArgv];
		if (originalWrapperPath === undefined) {
			delete process.env.CLITE_WRAPPER_PATH;
		} else {
			process.env.CLITE_WRAPPER_PATH = originalWrapperPath;
		}
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("detects npm installs from the wrapper path passed to the compiled binary", () => {
		const wrapperPath = createTempFile(
			"lib/node_modules/@clinebot/cli/bin/clite",
		);
		process.env.CLITE_WRAPPER_PATH = wrapperPath;
		process.argv = ["bun", "/$bunfs/root/clite", "update", "--verbose"];

		expect(getInstallationInfo("1.2.3")).toEqual({
			packageManager: PackageManager.NPM,
			updateCommand: "npm install -g @clinebot/cli@latest",
		});
	});

	it("uses the nightly tag when the current CLI version is nightly", () => {
		const wrapperPath = createTempFile(
			"lib/node_modules/@clinebot/cli/bin/clite",
		);
		process.env.CLITE_WRAPPER_PATH = wrapperPath;
		process.argv = ["bun", "/$bunfs/root/clite", "update", "--verbose"];

		expect(getInstallationInfo("1.2.3-nightly.456")).toEqual({
			packageManager: PackageManager.NPM,
			updateCommand: "npm install -g @clinebot/cli@nightly",
		});
	});

	it("falls back to unknown when only Bun's virtual compiled path is available", () => {
		delete process.env.CLITE_WRAPPER_PATH;
		process.argv = ["bun", "/$bunfs/root/clite", "update", "--verbose"];

		expect(getInstallationInfo("1.2.3")).toEqual({
			packageManager: PackageManager.UNKNOWN,
		});
	});
});
