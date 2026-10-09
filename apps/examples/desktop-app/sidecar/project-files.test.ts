import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	listLocalProjectEntries,
	PROJECT_FILE_READ_LIMIT_BYTES,
	parseRemoteListing,
	readLocalProjectFile,
} from "./project-files";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "cline-project-files-"));
	mkdirSync(join(root, ".git"));
	mkdirSync(join(root, "src"));
	writeFileSync(join(root, "src", "index.ts"), "export const a = 1;\n");
	writeFileSync(join(root, "README.md"), "# hi\n");
	writeFileSync(
		join(root, "logo.png"),
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]),
	);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("listLocalProjectEntries", () => {
	it("lists directories before files and hides .git", () => {
		const result = listLocalProjectEntries(root, root);
		expect(result.entries.map((entry) => [entry.name, entry.kind])).toEqual([
			["src", "directory"],
			["logo.png", "file"],
			["README.md", "file"],
		]);
		expect(result.truncated).toBe(false);
	});

	it("rejects paths outside the workspace root", () => {
		expect(() => listLocalProjectEntries(root, tmpdir())).toThrow(
			/outside the workspace/,
		);
		expect(() => listLocalProjectEntries(root, join(root, ".."))).toThrow(
			/outside the workspace/,
		);
	});

	it("accepts entries whose names merely start with two dots", () => {
		mkdirSync(join(root, "..notes"));
		writeFileSync(join(root, "..notes", "a.txt"), "x");
		expect(
			listLocalProjectEntries(root, join(root, "..notes")).entries,
		).toHaveLength(1);
	});
});

describe("readLocalProjectFile", () => {
	it("returns text contents", () => {
		expect(readLocalProjectFile(root, join(root, "README.md"))).toEqual({
			path: join(root, "README.md"),
			content: "# hi\n",
			truncated: false,
		});
	});

	it("returns null content for binary files", () => {
		expect(readLocalProjectFile(root, join(root, "logo.png")).content).toBe(
			null,
		);
	});

	it("caps large files and flags truncation", () => {
		const big = join(root, "big.txt");
		writeFileSync(big, "x".repeat(PROJECT_FILE_READ_LIMIT_BYTES + 10));
		const result = readLocalProjectFile(root, big);
		expect(result.truncated).toBe(true);
		expect(result.content?.length).toBe(PROJECT_FILE_READ_LIMIT_BYTES);
	});
});

describe("parseRemoteListing", () => {
	it("uses the trailing slash from ls -p to classify directories", () => {
		const result = parseRemoteListing(
			"/home/u/app",
			"src/\n.git/\npackage.json\n",
		);
		expect(result.entries).toEqual([
			{ name: "src", path: "/home/u/app/src", kind: "directory" },
			{ name: "package.json", path: "/home/u/app/package.json", kind: "file" },
		]);
	});
});
