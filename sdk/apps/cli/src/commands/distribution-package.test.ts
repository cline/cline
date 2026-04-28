import { spawnSync } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	DIRECT_PUBLISH_GUARD_MESSAGE,
	shouldAllowDirectPublish,
} from "../../script/guard-direct-publish";

describe("CLI distribution package shape", () => {
	it("rejects direct source package publishing by default", () => {
		expect(shouldAllowDirectPublish({})).toBe(false);
		expect(shouldAllowDirectPublish({ CLITE_ALLOW_DIRECT_PUBLISH: "1" })).toBe(
			true,
		);
		expect(DIRECT_PUBLISH_GUARD_MESSAGE).toContain(
			"Direct packaging or publishing from apps/cli is disabled.",
		);
	});

	it("rejects direct source package packing by default", () => {
		const cliRoot = fileURLToPath(new URL("../..", import.meta.url));

		const result = spawnSync("bun", ["pm", "pack", "--dry-run"], {
			cwd: cliRoot,
			encoding: "utf8",
		});

		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain(DIRECT_PUBLISH_GUARD_MESSAGE);
	});

	it("packs the generated npm wrapper package", async () => {
		const packageDir = await mkdtemp(join(tmpdir(), "cline-cli-pack-"));
		try {
			await mkdir(join(packageDir, "bin"), { recursive: true });
			await writeFile(
				join(packageDir, "package.json"),
				`${JSON.stringify(
					{
						name: "@clinebot/cli",
						version: "1.2.3",
						description: "CLI test package",
						license: "Apache-2.0",
						bin: {
							clite: "./bin/clite",
						},
						scripts: {
							postinstall: "node ./postinstall.mjs || true",
						},
						optionalDependencies: {
							"@clinebot/cli-linux-x64": "1.2.3",
						},
					},
					null,
					2,
				)}\n`,
			);
			await writeFile(
				join(packageDir, "bin", "clite"),
				[
					"#!/usr/bin/env node",
					'console.log("clite wrapper smoke test");',
					"",
				].join("\n"),
			);
			await chmod(join(packageDir, "bin", "clite"), 0o755);
			await writeFile(
				join(packageDir, "postinstall.mjs"),
				"process.exit(0);\n",
			);

			const result = spawnSync("bun", ["pm", "pack"], {
				cwd: packageDir,
				encoding: "utf8",
			});

			expect(result.status).toBe(0);
			const files = await readdir(packageDir);
			expect(files.some((file) => file.endsWith(".tgz"))).toBe(true);
		} finally {
			await rm(packageDir, { recursive: true, force: true });
		}
	});
});
