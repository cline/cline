import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("shared avatar catalog validation and firmware generation", () => {
	const result = Bun.spawnSync([
		"python3",
		resolve(import.meta.dir, "avatar_test.py"),
	]);
	expect(result.exitCode).toBe(0);
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
});
