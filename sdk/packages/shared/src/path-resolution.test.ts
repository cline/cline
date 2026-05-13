import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveExistingFilePath } from "./path-resolution";

describe("resolveExistingFilePath", () => {
	it("returns the literal path when it already exists", () => {
		const dir = mkdtempSync(join(tmpdir(), "path-resolution-literal-"));
		const filePath = join(dir, "plain.txt");
		writeFileSync(filePath, "hi");

		expect(resolveExistingFilePath(filePath)).toBe(filePath);
	});

	it("returns undefined when the file truly does not exist", () => {
		const dir = mkdtempSync(join(tmpdir(), "path-resolution-missing-"));
		expect(resolveExistingFilePath(join(dir, "nope.txt"))).toBeUndefined();
	});

	it("resolves macOS screenshot paths with narrow no-break space before PM", () => {
		// macOS Sonoma+ embeds U+202F before AM/PM. Callers often hand us a
		// path with a regular space because clipboards / terminals collapse
		// U+202F → U+0020 in transit.
		const dir = mkdtempSync(join(tmpdir(), "path-resolution-nnbsp-pm-"));
		const onDisk = "Screenshot 2026-05-12 at 4.42.48\u202FPM.png";
		const requested = join(dir, "Screenshot 2026-05-12 at 4.42.48 PM.png");
		writeFileSync(join(dir, onDisk), "hello");

		expect(resolveExistingFilePath(requested)).toBe(join(dir, onDisk));
	});

	it("resolves macOS screenshot paths with lowercase am/pm (en_AU style)", () => {
		const dir = mkdtempSync(join(tmpdir(), "path-resolution-nnbsp-am-"));
		const onDisk = "Screenshot 2026-01-01 at 10.00.00\u202Fam.png";
		const requested = join(dir, "Screenshot 2026-01-01 at 10.00.00 am.png");
		writeFileSync(join(dir, onDisk), "hello");

		expect(resolveExistingFilePath(requested)).toBe(join(dir, onDisk));
	});

	it("does not rewrite AM/PM text in directory components", () => {
		const parentDir = mkdtempSync(join(tmpdir(), "path-resolution-dir-ampm-"));
		const dir = join(parentDir, "my AM.photos");
		mkdirSync(dir);
		const onDisk = "Screenshot 2026-05-12 at 4.42.48\u202FPM.png";
		const requested = join(dir, "Screenshot 2026-05-12 at 4.42.48 PM.png");
		writeFileSync(join(dir, onDisk), "hello");

		expect(resolveExistingFilePath(requested)).toBe(join(dir, onDisk));
	});

	it("falls back to a parent-directory scan for arbitrary Unicode-space mismatches", () => {
		// Exercises the readdirSync fallback for cases the targeted
		// variants don't cover (here U+00A0 in the middle of a name).
		const dir = mkdtempSync(join(tmpdir(), "path-resolution-nbsp-mid-"));
		const onDisk = "weird\u00a0name.png";
		const requested = join(dir, "weird name.png");
		writeFileSync(join(dir, onDisk), "hello");

		expect(resolveExistingFilePath(requested)).toBe(join(dir, onDisk));
	});
});
