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
const sourceBinaryInstallPath = fileURLToPath(
	new URL("../../bin/binary-install.cjs", import.meta.url),
);

function createWrapperCopy(options?: { withBinaryInstall?: boolean }): string {
	const dir = mkdtempSync(join(tmpdir(), "cline-bin-package-"));
	const binDir = join(dir, "bin");
	mkdirSync(binDir, { recursive: true });
	const wrapperPath = join(binDir, "cline");
	copyFileSync(sourceWrapperPath, wrapperPath);
	chmodSync(wrapperPath, 0o755);
	if (options?.withBinaryInstall) {
		copyFileSync(sourceBinaryInstallPath, join(binDir, "binary-install.cjs"));
	}
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

	it("stays functional without the download helper", () => {
		// Damaged install: no platform package, no cache, no helper module.
		const wrapperPath = createWrapperCopy();

		const result = spawnSync(process.execPath, [wrapperPath, "--version"], {
			encoding: "utf8",
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"Could not find the Cline CLI binary for your platform.",
		);
		expect(result.stderr).toContain("npm install -g cline --force");
	});

	it("attempts a registry download when the platform package is missing", () => {
		const wrapperPath = createWrapperCopy({ withBinaryInstall: true });
		const packageDir = join(wrapperPath, "..", "..");
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({ name: "cline", version: "9.9.9" }),
		);

		// Unreachable registry so the download fails fast; asserts the
		// fallback is wired up and surfaces actionable guidance.
		const result = spawnSync(process.execPath, [wrapperPath, "--version"], {
			env: {
				...process.env,
				npm_config_registry: "http://127.0.0.1:1",
			},
			encoding: "utf8",
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"is missing from this install; downloading v9.9.9",
		);
		expect(result.stderr).toContain("Download failed:");
		expect(result.stderr).toContain("npm install -g cline --force");
	});
});
