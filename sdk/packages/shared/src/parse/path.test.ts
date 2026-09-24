import path from "node:path";
import { describe, expect, it } from "vitest";
import { toPosixSeparators } from "./path";

describe("toPosixSeparators", () => {
	it("rewrites the platform separator to forward slashes", () => {
		expect(toPosixSeparators(["src", "main.ts"].join(path.sep))).toBe(
			"src/main.ts",
		);
		expect(
			toPosixSeparators(["cline", "evals", "README.md"].join(path.sep)),
		).toBe("cline/evals/README.md");
	});

	it("leaves forward slashes and empty input untouched", () => {
		expect(toPosixSeparators("src/main.ts")).toBe("src/main.ts");
		expect(toPosixSeparators("")).toBe("");
		expect(toPosixSeparators("README.md")).toBe("README.md");
	});

	it.skipIf(process.platform === "win32")(
		"keeps a literal backslash in a POSIX filename",
		() => {
			expect(toPosixSeparators("foo\\bar.txt")).toBe("foo\\bar.txt");
			expect(toPosixSeparators("dir/foo\\bar.txt")).toBe("dir/foo\\bar.txt");
		},
	);

	it.runIf(process.platform === "win32")(
		"rewrites every backslash on Windows",
		() => {
			expect(toPosixSeparators("src\\a\\b\\c.ts")).toBe("src/a/b/c.ts");
		},
	);
});
