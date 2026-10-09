import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test.each([
	"application",
	"audio",
	"cardputer",
	"round-layout",
	"startup",
])("shared firmware %s behavior", async (fixture) => {
	const root = resolve(import.meta.dir, "..");
	const output = await mkdtemp(resolve(tmpdir(), "cline-firmware-test-"));
	try {
		const compile = Bun.spawnSync([
			"cc",
			"-std=c11",
			"-Wall",
			"-Wextra",
			"-Werror",
			"-Wno-unused-parameter",
			"-include",
			`${root}/tests/stubs/freertos/task.h`,
			...[
				"tests/stubs",
				"components/cline_app/include",
				"components/cline_model/include",
				"components/cline_transport/include",
				"components/cline_board/include",
				"components/cline_ui/include",
			].flatMap((p) => ["-I", `${root}/${p}`]),
			`${root}/tests/${fixture}.c`,
			"-o",
			`${output}/application`,
		]);
		expect(compile.stderr.toString()).toBe("");
		expect(compile.exitCode).toBe(0);
		const run = Bun.spawnSync([`${output}/application`]);
		expect(run.stderr.toString()).toBe("");
		expect(run.exitCode).toBe(0);
	} finally {
		await rm(output, { recursive: true, force: true });
	}
});
