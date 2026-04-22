import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplyPatchExecutor } from "./apply-patch";

describe("createApplyPatchExecutor", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apply-patch-"));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("applies the documented freeform patch format without shell wrappers", async () => {
		const filePath = path.join(tempDir, "page.tsx");
		await fs.writeFile(
			filePath,
			[
				"export default function Page() {",
				"\treturn (",
				"\t\t<div>",
				'\t\t\t<button onClick={() => console.log("clicked")}>Click me</button>',
				"\t\t</div>",
				"\t);",
				"}",
			].join("\n"),
			"utf-8",
		);

		const execute = createApplyPatchExecutor();
		const result = await execute(
			{
				input: [
					"*** Update File: page.tsx",
					"@@",
					" export default function Page() {",
					" \treturn (",
					" \t\t<div>",
					' \t\t\t<button onClick={() => console.log("clicked")}>Click me</button>',
					'+\t\t\t<button onClick={() => console.log("cancel clicked")}>Cancel</button>',
					" \t\t</div>",
					" \t);",
					" }",
				].join("\n"),
			},
			tempDir,
			{} as never,
		);

		await expect(fs.readFile(filePath, "utf-8")).resolves.toContain(
			'console.log("cancel clicked")',
		);
		expect(result).toContain("Successfully applied patch");
		expect(result).toContain("page.tsx");
	});

	it("accepts the legacy shell wrapper around the patch", async () => {
		const filePath = path.join(tempDir, "note.txt");
		const execute = createApplyPatchExecutor();

		await execute(
			{
				input: [
					"%%bash",
					'apply_patch <<"EOF"',
					"*** Begin Patch",
					"*** Add File: note.txt",
					"+hello",
					"*** End Patch",
					"EOF",
				].join("\n"),
			},
			tempDir,
			{} as never,
		);

		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("hello");
	});

	it("does not strip valid patch lines that begin with wrapper tokens after the patch prefix", async () => {
		const filePath = path.join(tempDir, "note.txt");
		await fs.writeFile(
			filePath,
			["alpha", "EOF literal", "``` fence", "omega"].join("\n"),
			"utf-8",
		);

		const execute = createApplyPatchExecutor();
		await execute(
			{
				input: [
					"*** Update File: note.txt",
					"@@",
					" alpha",
					" EOF literal",
					" ``` fence",
					"+tail",
					" omega",
				].join("\n"),
			},
			tempDir,
			{} as never,
		);

		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
			["alpha", "EOF literal", "``` fence", "tail", "omega"].join("\n"),
		);
	});

	it("accepts an end sentinel with trailing whitespace", async () => {
		const filePath = path.join(tempDir, "note.txt");
		const execute = createApplyPatchExecutor();

		await execute(
			{
				input: [
					"*** Begin Patch",
					"*** Add File: note.txt",
					"+hello",
					"*** End Patch ",
				].join("\n"),
			},
			tempDir,
			{} as never,
		);

		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("hello");
	});

	it("rejects incomplete patch sentinels", async () => {
		const execute = createApplyPatchExecutor();

		await expect(
			execute(
				{
					input: "*** Begin Patch\n*** Add File: note.txt\n+hello",
				},
				tempDir,
				{} as never,
			),
		).rejects.toThrow("Invalid patch text - incomplete sentinels");
	});
});
