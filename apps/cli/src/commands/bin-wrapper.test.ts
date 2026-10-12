import { spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
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

	it.skipIf(process.platform === "win32")(
		"forwards SIGTERM sent to the wrapper to the child on POSIX",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "cline-bin-signal-"));
			const pidFile = join(dir, "child.pid");
			const target = createExecutableScript(`
require("node:fs").writeFileSync(process.env.FIXTURE_PID_FILE, String(process.pid));
setInterval(() => {}, 1000);
`);
			const wrapper = spawn(process.execPath, [createWrapperCopy()], {
				env: {
					...process.env,
					CLINE_BIN_PATH: target,
					FIXTURE_PID_FILE: pidFile,
				},
				stdio: "ignore",
			});
			const exited = new Promise<NodeJS.Signals | null>((resolve) =>
				wrapper.on("exit", (_code, signal) => resolve(signal)),
			);
			let childPid = 0;
			for (let i = 0; i < 100 && !childPid; i++) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				try {
					childPid = Number(readFileSync(pidFile, "utf8"));
				} catch {}
			}
			expect(childPid).toBeGreaterThan(0);

			wrapper.kill("SIGTERM");

			expect(await exited).toBe("SIGTERM");
			expect(() => process.kill(childPid, 0)).toThrow();
		},
	);
});
