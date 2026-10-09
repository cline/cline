import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("CMake blocks implicit board selection and a reused generic build directory", async () => {
	const dir = await mkdtemp(join(tmpdir(), "cline-board-guard-"));
	try {
		const missing = Bun.spawnSync([
			"cmake",
			"-S",
			root,
			"-B",
			join(dir, "missing"),
		]);
		expect(missing.exitCode).not.toBe(0);
		expect(missing.stderr.toString()).toContain("No device selected");
		// Model the cache left by a previous plain idf.py invocation.
		await writeFile(
			join(dir, "missing/CMakeCache.txt"),
			"CLINE_BOARD:STRING=waveshare-s3-epaper-154\n",
		);
		const cached = Bun.spawnSync([
			"cmake",
			"-S",
			root,
			"-B",
			join(dir, "missing"),
		]);
		expect(cached.exitCode).not.toBe(0);
		expect(cached.stderr.toString()).toContain(
			"separate board build directory",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
