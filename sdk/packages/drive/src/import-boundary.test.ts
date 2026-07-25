import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architecture gate (drivecode-sdk/02-architecture.md):
 * `@cline/drive` may import from `@cline/shared` type-only so schemas can
 * later move without untangling runtime deps.
 */
function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			out.push(...listTsFiles(path));
			continue;
		}
		if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
			out.push(path);
		}
	}
	return out;
}

describe("import boundary", () => {
	it("only type-imports @cline/shared", () => {
		const root = join(import.meta.dirname, "..");
		const files = listTsFiles(root);
		const valueImport =
			/import\s+(?!type\b)[^;]*from\s+["']@cline\/shared["']/;

		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			if (valueImport.test(source)) {
				offenders.push(file);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("does not hard-code a :7891 writer", () => {
		const root = join(import.meta.dirname, "..");
		const files = listTsFiles(root);
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			expect(source.includes(":7891")).toBe(false);
		}
	});
});
