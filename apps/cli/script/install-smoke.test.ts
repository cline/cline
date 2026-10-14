import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileCliBinary } from "./compile-binary";

test.skipIf(process.platform === "win32")(
	"installs the compiled CLI without Node or Bun and retains its runtime identity",
	async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-installer-smoke-"));
		try {
			const binary = join(root, "cline");
			await compileCliBinary({
				bunTarget:
					`bun-${process.platform}-${process.arch}` as Bun.Build.CompileTarget,
				outfile: binary,
				autoloadLaunchDirectoryConfig: false,
			});
			const env = {
				...process.env,
				HOME: root,
				USERPROFILE: root,
				CLINE_DIR: join(root, ".cline"),
				CLINE_HUB_DISCOVERY_PATH: join(root, "hub-discovery.json"),
				CLINE_NO_AUTO_UPDATE: "1",
				CLINE_HUB_BUILD_ID: undefined,
				CLINE_HUB_BUILD_EPOCH_MS: undefined,
				CLINE_INSTALL_BUILD_ID: undefined,
				CLINE_INSTALL_BUILD_EPOCH_MS: undefined,
				BUN_BE_BUN: undefined,
				PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
			};
			const before = spawnSync(binary, ["--runtime-info"], {
				env,
				encoding: "utf8",
				timeout: 10000,
			});
			expect(before.status, before.stderr).toBe(0);
			const identity = JSON.parse(before.stdout);
			expect(identity.compiled).toBe(true);
			expect(identity.buildEpochMs, before.stdout).toBeGreaterThan(0);
			const install = spawnSync(
				"bash",
				[
					resolve(import.meta.dir, "install.sh"),
					"--binary",
					binary,
					"--no-modify-path",
				],
				{
					env: {
						...env,
						BUN_BE_BUN: "1",
						CLINE_HUB_BUILD_ID: "parent-hub",
						CLINE_HUB_BUILD_EPOCH_MS: "1",
					},
					encoding: "utf8",
					timeout: 15000,
				},
			);
			expect(install.status, install.stderr).toBe(0);
			const entry = join(root, ".local/bin/cline");
			expect(install.stdout.trim()).toBe(entry);
			const after = spawnSync(entry, ["--runtime-info"], {
				env,
				encoding: "utf8",
				timeout: 10000,
			});
			expect(after.status, after.stderr).toBe(0);
			expect(JSON.parse(after.stdout)).toMatchObject({
				buildId: identity.buildId,
				buildEpochMs: identity.buildEpochMs,
				target: identity.target,
				compiled: true,
			});
			expect(existsSync(env.CLINE_HUB_DISCOVERY_PATH)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
	60000,
);
