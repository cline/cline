import {
	Atom,
	Braces,
	FileKey2,
	FileLock2,
	FileText,
	Package,
} from "lucide-react";
import { describe, expect, it } from "vitest";
import { fileIconSpec } from "./file-icons";

describe("fileIconSpec", () => {
	it("picks icons by exact name before extension", () => {
		expect(fileIconSpec("/repo/package.json").icon).toBe(Package);
		expect(fileIconSpec("/repo/tsconfig.base.json").icon).toBe(Braces);
		expect(fileIconSpec("bun.lock").icon).toBe(FileLock2);
	});

	it("maps extensions case-insensitively and env files to keys", () => {
		expect(fileIconSpec("src/App.TSX").icon).toBe(Atom);
		expect(fileIconSpec(".env.local").icon).toBe(FileKey2);
	});

	it("ignores inherited object keys in filenames", () => {
		for (const name of [
			"constructor",
			"__proto__",
			"toString",
			"x.constructor",
		]) {
			expect(fileIconSpec(name).icon).toBe(FileText);
		}
	});

	it("falls back to a neutral document", () => {
		const spec = fileIconSpec("NOTICE");
		expect(spec.icon).toBe(FileText);
		expect(spec.className).toBe("text-muted-foreground");
	});
});
