import { spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceWrapperPath = fileURLToPath(
	new URL("../../bin/cline", import.meta.url),
);

function createWrapperCopy(): string {
	const dir = mkdtempSync(join(tmpdir(), "cline-bin-package-"));
	const binDir = join(dir, "bin");
	mkdirSync(binDir, { recursive: true });
	const wrapperPath = join(binDir, "cline");
	copyFileSync(sourceWrapperPath, wrapperPath);
	chmodSync(wrapperPath, 0o755);
	return wrapperPath;
}

function createExecutableScript(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "cline-bin-wrapper-"));
	const scriptPath = join(dir, "child.js");
	writeFileSync(scriptPath, `#!/usr/bin/env node\n${contents}`);
	chmodSync(scriptPath, 0o755);
	return scriptPath;
}

function runWrapper(target: string, args: string[] = []) {
	const wrapperPath = createWrapperCopy();
	return spawnSync(process.execPath, [wrapperPath, ...args], {
		env: {
			...process.env,
			CLINE_BIN_PATH: target,
		},
		encoding: "utf8",
	});
}

describe("bin/cline wrapper", () => {
	it("preserves the child process exit status", () => {
		const target = createExecutableScript(`
process.exit(Number(process.argv[2] ?? "0"));
`);

		const result = runWrapper(target, ["7"]);

		expect(result.error).toBeUndefined();
		expect(result.status).toBe(7);
		expect(result.signal).toBeNull();
	});

	it("passes the wrapper path to the compiled binary", () => {
		const target = createExecutableScript(`
console.log(process.env.CLINE_WRAPPER_PATH ?? "");
`);

		const result = runWrapper(target);

		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);
		expect(result.stdout.trim()).toMatch(/bin[/\\]cline$/);
	});

	it.skipIf(process.platform === "win32")(
		"propagates child process signal termination on POSIX",
		() => {
			const target = createExecutableScript(`
process.kill(process.pid, "SIGTERM");
setTimeout(() => {}, 1000);
`);

			const result = runWrapper(target);

			expect(result.error).toBeUndefined();
			expect(result.status).toBeNull();
			expect(result.signal).toBe("SIGTERM");
		},
	);
});
