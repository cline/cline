import { existsSync, readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApplyPatchExecutor } from "./apply-patch";
import { createEditorExecutor } from "./editor";

vi.mock("node:fs/promises", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...original,
		access: vi.fn(original.access),
		mkdir: vi.fn(original.mkdir),
		readFile: vi.fn(original.readFile),
	};
});

const context = { agentId: "agent-1", conversationId: "conv-1", iteration: 1 };

describe("createApplyPatchExecutor", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apply-patch-"));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("preserves concurrent patches to the same file", async () => {
		const filePath = path.join(tempDir, "note.txt");
		await fs.writeFile(filePath, "alpha: old\nbeta: old\n", "utf-8");
		const read = vi.mocked(fs.readFile).mockImplementation(async (file) => {
			const snapshot = readFileSync(String(file), "utf-8");
			await Promise.resolve();
			return snapshot;
		});
		try {
			const first = createApplyPatchExecutor();
			const second = createApplyPatchExecutor();
			const results = await Promise.all([
				first(
					{ input: "*** Update File: note.txt\n@@\n-alpha: old\n+alpha: new" },
					tempDir,
					context,
				),
				second(
					{ input: `*** Update File: ${filePath}\n@@\n-beta: old\n+beta: new` },
					tempDir,
					context,
				),
			]);
			expect(
				results.every((result) => result.includes("Successfully applied")),
			).toBe(true);
		} finally {
			read.mockRestore();
		}
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
			"alpha: new\nbeta: new\n",
		);
	});

	it("preserves simultaneous editor and patch changes to the same file", async () => {
		const filePath = path.join(tempDir, "note.txt");
		await fs.writeFile(filePath, "alpha: old\nbeta: old\n", "utf-8");
		const access = vi.mocked(fs.access).mockResolvedValue(undefined);
		const read = vi.mocked(fs.readFile).mockImplementation(async (file) => {
			const snapshot = readFileSync(String(file), "utf-8");
			await Promise.resolve();
			return snapshot;
		});
		try {
			const editor = createEditorExecutor();
			const patch = createApplyPatchExecutor();
			const [edited, patched] = await Promise.all([
				editor(
					{ path: filePath, old_text: "alpha: old", new_text: "alpha: new" },
					tempDir,
					context,
				),
				patch(
					{ input: "*** Update File: ./note.txt\n@@\n-beta: old\n+beta: new" },
					tempDir,
					context,
				),
			]);
			expect(edited).toContain("Edited");
			expect(patched).toContain("Successfully applied");
		} finally {
			read.mockRestore();
			access.mockRestore();
		}
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
			"alpha: new\nbeta: new\n",
		);
	});

	it("does not let concurrent patches both add the same file", async () => {
		const filePath = path.join(tempDir, "new.txt");
		const read = vi.mocked(fs.readFile).mockImplementation(async (file) => {
			const snapshot = readFileSync(String(file), "utf-8");
			await Promise.resolve();
			return snapshot;
		});
		try {
			const patch = createApplyPatchExecutor();
			const [first, second] = await Promise.allSettled([
				patch({ input: "*** Add File: new.txt\n+first" }, tempDir, context),
				patch({ input: "*** Add File: ./new.txt\n+second" }, tempDir, context),
			]);
			expect(first.status).toBe("fulfilled");
			expect(second.status).toBe("rejected");
			if (second.status === "rejected") {
				expect(String(second.reason)).toContain("File already exists");
			}
		} finally {
			read.mockRestore();
		}
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("first");
	});

	it("lets an editor change a file created by an earlier patch", async () => {
		const filePath = path.join(tempDir, "new.txt");
		const patch = createApplyPatchExecutor();
		const editor = createEditorExecutor();
		const [created, edited] = await Promise.all([
			patch({ input: "*** Add File: new.txt\n+created" }, tempDir, context),
			editor(
				{ path: filePath, old_text: "created", new_text: "edited" },
				tempDir,
				context,
			),
		]);
		expect(created).toContain("Successfully applied");
		expect(edited).toContain(`Edited ${filePath}`);
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("edited");
	});

	it("lets an editor recreate a file after an earlier patch deletes it", async () => {
		const filePath = path.join(tempDir, "note.txt");
		await fs.writeFile(filePath, "original", "utf-8");
		const access = vi.mocked(fs.access).mockImplementation(async (file) => {
			const exists = existsSync(String(file));
			await Promise.resolve();
			if (!exists) throw new Error("File does not exist");
		});
		try {
			const patch = createApplyPatchExecutor();
			const editor = createEditorExecutor();
			const [deleted, created] = await Promise.all([
				patch({ input: "*** Delete File: note.txt" }, tempDir, context),
				editor({ path: filePath, new_text: "recreated" }, tempDir, context),
			]);
			expect(deleted).toContain("note.txt: [deleted]");
			expect(created).toBe(`File created successfully at: ${filePath}`);
		} finally {
			access.mockRestore();
		}
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("recreated");
	});

	it("waits for a patch moving to a file before editing the destination", async () => {
		const source = path.join(tempDir, "source.txt");
		const destination = path.join(tempDir, "destination.txt");
		await fs.writeFile(source, "alpha: old\nbeta: old\n", "utf-8");
		await fs.writeFile(destination, "other\nbeta: old\n", "utf-8");
		let startMove!: () => void;
		let releaseMove!: () => void;
		let destinationRead = false;
		const moveStarted = new Promise<void>((resolve) => {
			startMove = resolve;
		});
		const moveReleased = new Promise<void>((resolve) => {
			releaseMove = resolve;
		});
		const mkdir = vi.mocked(fs.mkdir).mockImplementation(async () => {
			startMove();
			await moveReleased;
			return undefined;
		});
		const access = vi.mocked(fs.access).mockResolvedValue(undefined);
		const read = vi.mocked(fs.readFile).mockImplementation(async (file) => {
			if (String(file) === destination) destinationRead = true;
			return readFileSync(String(file), "utf-8");
		});
		const patch = createApplyPatchExecutor();
		const editor = createEditorExecutor();
		const moving = patch(
			{
				input:
					"*** Update File: source.txt\n*** Move to: destination.txt\n@@\n-alpha: old\n+alpha: moved",
			},
			tempDir,
			context,
		);
		let editing: Promise<string> | undefined;
		try {
			await moveStarted;
			editing = editor(
				{ path: destination, old_text: "beta: old", new_text: "beta: edited" },
				tempDir,
				context,
			);
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(destinationRead).toBe(false);
		} finally {
			releaseMove();
			await Promise.allSettled([moving, ...(editing ? [editing] : [])]);
			mkdir.mockRestore();
			access.mockRestore();
			read.mockRestore();
		}
		await expect(moving).resolves.toContain("source.txt -> destination.txt");
		await expect(editing).resolves.toContain(`Edited ${destination}`);
		await expect(fs.readFile(destination, "utf-8")).resolves.toBe(
			"alpha: moved\nbeta: edited\n",
		);
		expect(existsSync(source)).toBe(false);
	});

	it("continues queued patches after a failed patch", async () => {
		const filePath = path.join(tempDir, "note.txt");
		await fs.writeFile(filePath, "alpha: old\nbeta: old\n", "utf-8");
		const patch = createApplyPatchExecutor();
		const failed = patch(
			{ input: "*** Update File: note.txt\n@@\n-missing\n+ignored" },
			tempDir,
			context,
		);
		const next = patch(
			{ input: "*** Update File: note.txt\n@@\n-alpha: old\n+alpha: new" },
			tempDir,
			context,
		);
		await Promise.all([
			expect(failed).rejects.toThrow("hunk"),
			expect(next).resolves.toContain("Successfully applied"),
		]);
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
			"alpha: new\nbeta: old\n",
		);
	});

	it("does not block patches to different files", async () => {
		const firstPath = path.join(tempDir, "first.txt");
		const secondPath = path.join(tempDir, "second.txt");
		await fs.writeFile(firstPath, "first: old", "utf-8");
		await fs.writeFile(secondPath, "second: old", "utf-8");
		let startFirstRead!: () => void;
		let releaseFirstRead!: () => void;
		const firstReadStarted = new Promise<void>((resolve) => {
			startFirstRead = resolve;
		});
		const firstReadReleased = new Promise<void>((resolve) => {
			releaseFirstRead = resolve;
		});
		const read = vi.mocked(fs.readFile).mockImplementation(async (file) => {
			const snapshot = readFileSync(String(file), "utf-8");
			if (String(file) === firstPath) {
				startFirstRead();
				await firstReadReleased;
			}
			return snapshot;
		});
		const patch = createApplyPatchExecutor();
		const first = patch(
			{ input: "*** Update File: first.txt\n@@\n-first: old\n+first: new" },
			tempDir,
			context,
		);
		await firstReadStarted;
		const second = patch(
			{ input: "*** Update File: second.txt\n@@\n-second: old\n+second: new" },
			tempDir,
			context,
		);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await expect(
				Promise.race([
					second,
					new Promise<string>((_, reject) => {
						timer = setTimeout(
							() => reject(new Error("Second file was blocked")),
							2000,
						);
					}),
				]),
			).resolves.toContain("Successfully applied");
		} finally {
			if (timer) clearTimeout(timer);
			releaseFirstRead();
			await Promise.allSettled([first, second]);
			read.mockRestore();
		}
		await expect(fs.readFile(firstPath, "utf-8")).resolves.toBe("first: new");
		await expect(fs.readFile(secondPath, "utf-8")).resolves.toBe("second: new");
	});

	it("serializes overlapping multi-file patches even in opposite path order", async () => {
		const firstPath = path.join(tempDir, "first.txt");
		const secondPath = path.join(tempDir, "second.txt");
		await fs.writeFile(firstPath, "first: old", "utf-8");
		await fs.writeFile(secondPath, "second: old", "utf-8");
		const patch = createApplyPatchExecutor();
		const first = patch(
			{
				input:
					"*** Update File: first.txt\n@@\n-first: old\n+first: middle\n*** Update File: second.txt\n@@\n-second: old\n+second: middle",
			},
			tempDir,
			context,
		);
		const second = patch(
			{
				input:
					"*** Update File: second.txt\n@@\n-second: middle\n+second: new\n*** Update File: first.txt\n@@\n-first: middle\n+first: new",
			},
			tempDir,
			context,
		);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await expect(
				Promise.race([
					Promise.all([first, second]),
					new Promise<string[]>((_, reject) => {
						timer = setTimeout(
							() => reject(new Error("Patches stalled")),
							2000,
						);
					}),
				]),
			).resolves.toHaveLength(2);
		} finally {
			if (timer) clearTimeout(timer);
		}
		await expect(fs.readFile(firstPath, "utf-8")).resolves.toBe("first: new");
		await expect(fs.readFile(secondPath, "utf-8")).resolves.toBe("second: new");
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
});
