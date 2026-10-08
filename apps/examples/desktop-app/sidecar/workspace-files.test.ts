import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	MAX_READ_WORKSPACE_FILE_BYTES,
	readWorkspaceFile,
} from "./workspace-files";

describe("readWorkspaceFile", () => {
	let base: string;
	let root: string;

	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), "workspace-files-"));
		root = join(base, "repo");
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "index.ts"), "export const a = 1;\n");
		writeFileSync(join(base, "secret.txt"), "outside");
	});

	afterEach(() => {
		rmSync(base, { recursive: true, force: true });
	});

	it("reads text files relative to the workspace root", async () => {
		await expect(readWorkspaceFile(root, "src/index.ts")).resolves.toEqual({
			path: "src/index.ts",
			size: 20,
			contents: "export const a = 1;\n",
			binary: false,
			truncated: false,
		});
	});

	it("rejects paths that escape the workspace", async () => {
		await expect(readWorkspaceFile(root, "../secret.txt")).rejects.toThrow(
			"outside the workspace",
		);
		symlinkSync(join(base, "secret.txt"), join(root, "link.txt"));
		await expect(readWorkspaceFile(root, "link.txt")).rejects.toThrow(
			"outside the workspace",
		);
	});

	it("flags binary files without returning their bytes", async () => {
		writeFileSync(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0, 0x47]));
		await expect(readWorkspaceFile(root, "logo.png")).resolves.toMatchObject({
			binary: true,
			contents: "",
		});
	});

	it("truncates large files", async () => {
		writeFileSync(
			join(root, "big.txt"),
			"a".repeat(MAX_READ_WORKSPACE_FILE_BYTES + 10),
		);
		const result = await readWorkspaceFile(root, "big.txt");
		expect(result.truncated).toBe(true);
		expect(result.contents).toHaveLength(MAX_READ_WORKSPACE_FILE_BYTES);
	});

	it("rejects directories", async () => {
		await expect(readWorkspaceFile(root, "src")).rejects.toThrow("Not a file");
	});
});
