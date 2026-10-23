import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplyPatchExecutor } from "./apply-patch";

describe("createApplyPatchExecutor", () => {
	let tempDir: string;
	const createLargeLine = (middleChar = "a") =>
		`${"x".repeat(750)}${middleChar}${"y".repeat(750)}`;

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

	// The CRLF branch is exercised for real by Windows CI, where os.EOL is
	// "\r\n" (github.com/cline/cline/issues/13504).
	it("adds new files with the platform-native line ending", async () => {
		const filePath = path.join(tempDir, "added.txt");
		const execute = createApplyPatchExecutor();

		await execute(
			{
				input: [
					"*** Begin Patch",
					"*** Add File: added.txt",
					"+one",
					"+two",
					"*** End Patch",
				].join("\n"),
			},
			tempDir,
			{} as never,
		);

		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
			["one", "two"].join(os.EOL),
		);
	});

	it("preserves CRLF line endings when updating a CRLF file", async () => {
		const filePath = path.join(tempDir, "note.txt");
		await fs.writeFile(filePath, "alpha\r\nbeta\r\ngamma", "utf-8");
		const execute = createApplyPatchExecutor();

		// Models emit LF-only patch text even for CRLF files.
		await execute(
			{
				input: [
					"*** Update File: note.txt",
					"@@",
					" alpha",
					"-beta",
					"+BETA",
					"+inserted",
					" gamma",
				].join("\n"),
			},
			tempDir,
			{} as never,
		);

		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
			"alpha\r\nBETA\r\ninserted\r\ngamma",
		);
	});

	it("preserves CRLF line endings when a patch moves a CRLF file", async () => {
		const filePath = path.join(tempDir, "old.txt");
		await fs.writeFile(filePath, "one\r\ntwo", "utf-8");
		const execute = createApplyPatchExecutor();

		await execute(
			{
				input: [
					"*** Update File: old.txt",
					"*** Move to: new.txt",
					"@@",
					" one",
					"-two",
					"+TWO",
				].join("\n"),
			},
			tempDir,
			{} as never,
		);

		await expect(
			fs.readFile(path.join(tempDir, "new.txt"), "utf-8"),
		).resolves.toBe("one\r\nTWO");
	});

	it("updates a pure-LF file without introducing CRLF", async () => {
		const filePath = path.join(tempDir, "lf.txt");
		await fs.writeFile(filePath, "one\ntwo\nthree", "utf-8");
		const execute = createApplyPatchExecutor();

		await execute(
			{
				input: [
					"*** Update File: lf.txt",
					"@@",
					" one",
					"-two",
					"+TWO",
					" three",
				].join("\n"),
			},
			tempDir,
			{} as never,
		);

		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
			"one\nTWO\nthree",
		);
	});

	it("refuses to add a file that already exists", async () => {
		const filePath = path.join(tempDir, "note.txt");
		await fs.writeFile(filePath, "important data", "utf-8");
		const execute = createApplyPatchExecutor();

		await expect(
			execute(
				{
					input: [
						"*** Begin Patch",
						"*** Add File: note.txt",
						"+overwritten",
						"*** End Patch",
					].join("\n"),
				},
				tempDir,
				{} as never,
			),
		).rejects.toThrow("Add File Error: File already exists: note.txt");

		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
			"important data",
		);
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

	it("rejects a patch when a hunk context does not match", async () => {
		const filePath = path.join(tempDir, "note.txt");
		const original = ["alpha", "beta", "gamma"].join("\n");
		await fs.writeFile(filePath, original, "utf-8");
		const execute = createApplyPatchExecutor();

		await expect(
			execute(
				{
					input: [
						"*** Update File: note.txt",
						"@@",
						" unrelated heading",
						" missing middle",
						"+replacement",
						" absent footer",
					].join("\n"),
				},
				tempDir,
				{} as never,
			),
		).rejects.toThrow(/note\.txt: hunk 1: Could not find matching context/);

		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(original);
	});

	it("applies an oversized exact match", async () => {
		const filePath = path.join(tempDir, "large.txt");
		const largeLine = createLargeLine();
		await fs.writeFile(filePath, largeLine, "utf-8");

		const execute = createApplyPatchExecutor();
		const result = await execute(
			{
				input: [
					"*** Update File: large.txt",
					"@@",
					` ${largeLine}`,
					"+tail",
				].join("\n"),
			},
			tempDir,
			{} as never,
		);

		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
			`${largeLine}\ntail`,
		);
		expect(result).toContain("Successfully applied patch");
	});

	it("rejects an oversized near match (fail closed)", async () => {
		const filePath = path.join(tempDir, "large.txt");
		const expectedLine = createLargeLine("a");
		const actualLine = createLargeLine("b");
		await fs.writeFile(filePath, actualLine, "utf-8");

		const execute = createApplyPatchExecutor();

		await expect(
			execute(
				{
					input: [
						"*** Update File: large.txt",
						"@@",
						` ${expectedLine}`,
						"+tail",
					].join("\n"),
				},
				tempDir,
				{} as never,
			),
		).rejects.toThrow(/large\.txt: hunk 1: Could not find matching context/);

		// File content must remain unchanged
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(actualLine);
	});

	it("rejects a patch when oversized near-match would match the wrong anchor", async () => {
		const filePath = path.join(tempDir, "large.txt");

		// Two plausible oversized anchors. Each is a large line with a unique
		// middle character so they are clearly distinguishable.
		const anchorA = createLargeLine("A");
		const anchorB = createLargeLine("B");

		// The file contains both anchors.
		await fs.writeFile(
			filePath,
			[anchorA, anchorB].join("\n"),
			"utf-8",
		);

		// Create a patch intended for Anchor A, but with edits at both the
		// beginning and end so it is no longer an exact match. The prefix/suffix
		// heuristic would previously give a high similarity to both anchors,
		// risking application to the wrong one.
		const patchedAnchorA = `ZZZ${anchorA.slice(3, -3)}YYY`;

		const execute = createApplyPatchExecutor();

		await expect(
			execute(
				{
					input: [
						"*** Update File: large.txt",
						"@@",
						` ${patchedAnchorA}`,
						"+tail",
					].join("\n"),
				},
				tempDir,
				{} as never,
			),
		).rejects.toThrow(/large\.txt: hunk 1: Could not find matching context/);

		// File content must remain completely unchanged — the patch must NOT
		// apply to either anchor.
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
			[anchorA, anchorB].join("\n"),
		);
	});
});
