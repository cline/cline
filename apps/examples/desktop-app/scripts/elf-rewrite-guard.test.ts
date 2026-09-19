import { describe, expect, test } from "bun:test";
import {
	appendFileSync,
	copyFileSync,
	mkdtempSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { protectedTargetsOf } from "./elf-rewrite-guard";

const SET_RPATH = ["--set-rpath", "$ORIGIN/../lib"];

// The guard only has to recognise ELF payloads, and only Linux produces them
// here; on macOS a compiled Bun binary is a Mach-O and linuxdeploy never runs.
const describeLinux = process.platform === "linux" ? describe : describe.skip;

describeLinux("protectedTargetsOf", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "elf-rewrite-guard-"));

	const compiledBun = path.join(dir, "compiled-bun");
	writeFileSync(path.join(dir, "entry.ts"), "console.log('ok');\n");
	Bun.spawnSync([
		process.execPath,
		"build",
		path.join(dir, "entry.ts"),
		"--compile",
		"--outfile",
		compiledBun,
	]);

	const plainElf = path.join(dir, "plain-elf");
	copyFileSync("/bin/sh", plainElf);

	const upxPacked = path.join(dir, "upx-packed");
	copyFileSync("/bin/sh", upxPacked);
	appendFileSync(upxPacked, "UPX!\u0000\u0000\u0000\u0000");

	test("a bun --compile executable is never rewritten", () => {
		expect(protectedTargetsOf([...SET_RPATH, compiledBun])).toEqual([
			compiledBun,
		]);
	});

	test("a UPX-packed executable is never rewritten", () => {
		expect(protectedTargetsOf([...SET_RPATH, upxPacked])).toEqual([upxPacked]);
	});

	test("read-only queries are forwarded", () => {
		expect(protectedTargetsOf(["--print-rpath", compiledBun])).toEqual([]);
	});

	test("ordinary binaries are forwarded", () => {
		expect(protectedTargetsOf([...SET_RPATH, plainElf])).toEqual([]);
	});
});
