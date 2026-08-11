import { spawnSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

const baseline = require("../../bin/baseline.cjs") as {
	supportsAvx2: (platform: string, arch: string) => boolean;
	platformPackageNames: (
		platform: string,
		arch: string,
		avx2: boolean,
	) => string[];
	resolvePlatformPackageNames: (platform: string, arch: string) => string[];
};

describe("baseline binary selection", () => {
	it("prefers the default package on x64 with AVX2", () => {
		expect(baseline.platformPackageNames("linux", "x64", true)).toEqual([
			"@cline/cli-linux-x64",
			"@cline/cli-linux-x64-baseline",
		]);
	});

	it("prefers the baseline package on x64 without AVX2", () => {
		for (const platform of ["linux", "darwin", "windows"]) {
			expect(baseline.platformPackageNames(platform, "x64", false)).toEqual([
				`@cline/cli-${platform}-x64-baseline`,
				`@cline/cli-${platform}-x64`,
			]);
		}
	});

	it("only offers the default package on non-x64 architectures", () => {
		expect(baseline.platformPackageNames("darwin", "arm64", false)).toEqual([
			"@cline/cli-darwin-arm64",
		]);
		expect(baseline.platformPackageNames("linux", "arm64", true)).toEqual([
			"@cline/cli-linux-arm64",
		]);
	});

	it("reports no AVX2 on non-x64 architectures", () => {
		expect(baseline.supportsAvx2("darwin", "arm64")).toBe(false);
		expect(baseline.supportsAvx2("linux", "arm64")).toBe(false);
	});

	it("reports no AVX2 on unknown platforms", () => {
		expect(baseline.supportsAvx2("freebsd", "x64")).toBe(false);
	});

	it("resolves a coherent preference order for the current machine", () => {
		const names = baseline.resolvePlatformPackageNames("linux", "x64");
		const avx2 = baseline.supportsAvx2("linux", "x64");
		expect(names).toEqual(baseline.platformPackageNames("linux", "x64", avx2));
	});
});

describe.skipIf(process.platform === "win32")(
	"bin/cline runtime fallback",
	() => {
		const cliRoot = fileURLToPath(new URL("../..", import.meta.url));

		// Build a fake installed tree: node_modules/cline holds the resolver, and
		// the platform package(s) hold stub "binaries" (shell scripts).
		function setupTree(input: {
			cachedScript?: string;
			packageScripts: Record<string, string>;
		}): { treeDir: string; resolver: string } {
			const treeDir = mkdtempSync(join(tmpdir(), "cline-resolver-test-"));
			const wrapperBin = join(treeDir, "node_modules", "cline", "bin");
			mkdirSync(wrapperBin, { recursive: true });
			cpSync(join(cliRoot, "bin", "cline"), join(wrapperBin, "cline"));
			cpSync(
				join(cliRoot, "bin", "baseline.cjs"),
				join(wrapperBin, "baseline.cjs"),
			);
			if (input.cachedScript) {
				const cachedPath = join(wrapperBin, ".cline");
				writeFileSync(cachedPath, input.cachedScript);
				chmodSync(cachedPath, 0o755);
			}
			for (const [name, script] of Object.entries(input.packageScripts)) {
				const binDir = join(treeDir, "node_modules", name, "bin");
				mkdirSync(binDir, { recursive: true });
				const binPath = join(binDir, "cline");
				writeFileSync(binPath, script);
				chmodSync(binPath, 0o755);
			}
			return { treeDir, resolver: join(wrapperBin, "cline") };
		}

		function currentPlatformPackage(): string {
			const platform =
				process.platform === "win32" ? "windows" : process.platform;
			return baseline.resolvePlatformPackageNames(platform, process.arch)[0];
		}

		it("falls back to the next candidate when a binary dies at startup", () => {
			const { treeDir, resolver } = setupTree({
				// Simulates an AVX2 binary cached on different hardware: dies
				// with SIGILL before doing any work.
				cachedScript: "#!/bin/sh\nkill -ILL $$\n",
				packageScripts: {
					[currentPlatformPackage()]: "#!/bin/sh\necho FALLBACK_OK\n",
				},
			});
			try {
				const result = spawnSync(process.execPath, [resolver], {
					encoding: "utf8",
				});
				expect(result.stdout).toContain("FALLBACK_OK");
				expect(result.stderr).toContain("failed to start");
				expect(result.status).toBe(0);
			} finally {
				rmSync(treeDir, { recursive: true, force: true });
			}
		});

		it("does not retry on an ordinary nonzero exit", () => {
			const { treeDir, resolver } = setupTree({
				// Runs the user's command and fails normally; the resolver must
				// propagate the exit code without executing another binary.
				cachedScript: "#!/bin/sh\necho RAN_ONCE\nexit 3\n",
				packageScripts: {
					[currentPlatformPackage()]: "#!/bin/sh\necho SHOULD_NOT_RUN\n",
				},
			});
			try {
				const result = spawnSync(process.execPath, [resolver], {
					encoding: "utf8",
				});
				expect(result.stdout).toContain("RAN_ONCE");
				expect(result.stdout).not.toContain("SHOULD_NOT_RUN");
				expect(result.status).toBe(3);
			} finally {
				rmSync(treeDir, { recursive: true, force: true });
			}
		});

		it("propagates the crash when no fallback candidate remains", () => {
			const { treeDir, resolver } = setupTree({
				packageScripts: {
					[currentPlatformPackage()]: "#!/bin/sh\nkill -ILL $$\n",
				},
			});
			try {
				const result = spawnSync(process.execPath, [resolver], {
					encoding: "utf8",
				});
				expect(result.status).not.toBe(0);
				expect(result.stdout).not.toContain("FALLBACK_OK");
			} finally {
				rmSync(treeDir, { recursive: true, force: true });
			}
		});
	},
);
