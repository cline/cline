import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIgnoreMatcher } from "./ignore-matcher";

describe("ignore-matcher", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await mkdtemp(path.join(tmpdir(), "ignore-matcher-test-"));
	});

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});

	async function write(relPath: string, content: string) {
		const full = path.join(cwd, relPath);
		await mkdir(path.dirname(full), { recursive: true });
		await writeFile(full, content);
	}

	it("ignores a path matched by root .gitignore", async () => {
		await write(".gitignore", "build/\n");
		await write("build/generated.js", "SOME_IDENTIFIER");

		const matcher = await buildIgnoreMatcher(cwd, [
			".gitignore",
			"build/generated.js",
		]);

		expect(matcher.isIgnored("build/generated.js")).toBe(true);
	});

	it("does not ignore a path .gitignore doesn't mention", async () => {
		await write(".gitignore", "build/\n");
		await write("src/index.ts", "export {}");

		const matcher = await buildIgnoreMatcher(cwd, [
			".gitignore",
			"src/index.ts",
		]);

		expect(matcher.isIgnored("src/index.ts")).toBe(false);
	});

	it("does not ignore anything when no .gitignore exists", async () => {
		await write("src/index.ts", "export {}");

		const matcher = await buildIgnoreMatcher(cwd, ["src/index.ts"]);

		expect(matcher.isIgnored("src/index.ts")).toBe(false);
	});

	it("honors negation within a single .gitignore", async () => {
		await write(".gitignore", "logs/*\n!logs/keep.log\n");
		await write("logs/debug.log", "x");
		await write("logs/keep.log", "x");

		const matcher = await buildIgnoreMatcher(cwd, [
			".gitignore",
			"logs/debug.log",
			"logs/keep.log",
		]);

		expect(matcher.isIgnored("logs/debug.log")).toBe(true);
		expect(matcher.isIgnored("logs/keep.log")).toBe(false);
	});

	it("does NOT let a nested .gitignore re-include a path whose parent directory is already excluded (gitignore(5): a parent directory exclusion cannot be undone by a nested file)", async () => {
		await write(".gitignore", "vendor/\n");
		await write("vendor/.gitignore", "!keep-this/\n!keep-this/**\n");
		await write("vendor/keep-this/readme.md", "x");

		const matcher = await buildIgnoreMatcher(cwd, [
			".gitignore",
			"vendor/.gitignore",
			"vendor/keep-this/readme.md",
		]);

		// This looks surprising but matches real git: once a directory is
		// excluded, git never even inspects its contents (including nested
		// .gitignore files), so a nested negation has no effect. If this
		// assertion ever needs to change, it should be because a deliberate
		// decision was made to diverge from real gitignore semantics here --
		// not because it was "fixed" to allow re-inclusion.
		expect(matcher.isIgnored("vendor/keep-this/readme.md")).toBe(true);
	});

	it("lets a nested .gitignore add its own additional excludes beyond what a shallower file covers", async () => {
		await write(".gitignore", "build/\n");
		await write("src/.gitignore", "generated/\n");
		await write("src/generated/codegen.ts", "x");
		await write("src/handwritten.ts", "x");

		const matcher = await buildIgnoreMatcher(cwd, [
			".gitignore",
			"src/.gitignore",
			"src/generated/codegen.ts",
			"src/handwritten.ts",
		]);

		expect(matcher.isIgnored("src/generated/codegen.ts")).toBe(true);
		expect(matcher.isIgnored("src/handwritten.ts")).toBe(false);
	});
});
