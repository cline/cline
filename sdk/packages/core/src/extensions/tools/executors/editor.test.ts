import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createEditorExecutor } from "./editor";

const context = {
	agentId: "agent-1",
	conversationId: "conv-1",
	iteration: 1,
};

async function withTempFile(
	content: string,
	run: (filePath: string, dir: string) => Promise<void>,
): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-editor-"));
	const filePath = path.join(dir, "example.txt");
	await fs.writeFile(filePath, content, "utf-8");
	try {
		await run(filePath, dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("createEditorExecutor", () => {
	it("creates a missing file when edit is used", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-editor-"));
		const filePath = path.join(dir, "example.txt");

		try {
			const editor = createEditorExecutor();
			const result = await editor(
				{
					path: filePath,
					new_text: "created with edit",
				},
				dir,
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
				},
			);

			expect(result).toBe(`File created successfully at: ${filePath}`);
			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
				"created with edit",
			);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("inserts before a one-based line and appends at the EOF boundary", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-editor-"));
		const filePath = path.join(dir, "example.txt");
		await fs.writeFile(filePath, "one\ntwo", "utf-8");

		try {
			const editor = createEditorExecutor();
			await editor(
				{
					path: filePath,
					new_text: "inserted",
					insert_line: 2,
				},
				dir,
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
				},
			);

			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
				"one\ninserted\ntwo",
			);

			await editor(
				{
					path: filePath,
					new_text: "tail",
					insert_line: 4,
				},
				dir,
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
				},
			);

			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
				"one\ninserted\ntwo\ntail",
			);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("emits a minimal diff for an in-place single-line edit", async () => {
		await withTempFile("a\nb\nc", async (filePath, dir) => {
			const editor = createEditorExecutor();
			const result = await editor(
				{ path: filePath, old_text: "b", new_text: "B" },
				dir,
				context,
			);

			expect(result).toBe(
				`Edited ${filePath}\n\`\`\`diff\n-2: b\n+2: B\n\`\`\``,
			);
		});
	});

	it("only emits the changed region when the edit changes the line count", async () => {
		await withTempFile("a\nb\nc\nd\ne\nf", async (filePath, dir) => {
			const editor = createEditorExecutor();
			const result = await editor(
				{ path: filePath, old_text: "b\nc\nd", new_text: "B" },
				dir,
				context,
			);

			// The trailing unchanged lines (e, f) must not be mispaired into
			// the diff even though their positions shifted.
			expect(result).toBe(
				`Edited ${filePath}\n\`\`\`diff\n-2: b\n-3: c\n-4: d\n+2: B\n\`\`\``,
			);
			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
				"a\nB\ne\nf",
			);
		});
	});

	it("emits only additions for a pure insertion via str_replace", async () => {
		await withTempFile("a\nb\nc", async (filePath, dir) => {
			const editor = createEditorExecutor();
			const result = await editor(
				{ path: filePath, old_text: "a\nb", new_text: "a\nnew\nb" },
				dir,
				context,
			);

			expect(result).toBe(
				`Edited ${filePath}\n\`\`\`diff\n+2: new\n\`\`\``,
			);
		});
	});

	it("truncates long diffs at maxDiffLines while keeping both sides visible", async () => {
		const oldLines = Array.from({ length: 10 }, (_, i) => `old-${i}`);
		await withTempFile(oldLines.join("\n"), async (filePath, dir) => {
			const editor = createEditorExecutor({ maxDiffLines: 3 });
			const result = await editor(
				{
					path: filePath,
					old_text: oldLines.join("\n"),
					new_text: "replaced",
				},
				dir,
				context,
			);

			expect(result).toBe(
				`Edited ${filePath}\n\`\`\`diff\n-1: old-0\n-2: old-1\n+1: replaced\n... diff truncated (8 more removed, 0 more added lines) ...\n\`\`\``,
			);
		});
	});

	it("does not drop additions when removals alone exhaust maxDiffLines", async () => {
		const oldLines = Array.from({ length: 6 }, (_, i) => `old-${i}`);
		const newLines = Array.from({ length: 4 }, (_, i) => `new-${i}`);
		await withTempFile(oldLines.join("\n"), async (filePath, dir) => {
			const editor = createEditorExecutor({ maxDiffLines: 6 });
			const result = await editor(
				{
					path: filePath,
					old_text: oldLines.join("\n"),
					new_text: newLines.join("\n"),
				},
				dir,
				context,
			);

			// Budget splits 3/3 instead of removals consuming all 6 lines and
			// reporting +0 additions.
			expect(result).toBe(
				`Edited ${filePath}\n\`\`\`diff\n-1: old-0\n-2: old-1\n-3: old-2\n+1: new-0\n+2: new-1\n+3: new-2\n... diff truncated (3 more removed, 1 more added lines) ...\n\`\`\``,
			);
		});
	});

	it("rejects insert_line 0 with the valid one-based boundary range", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-editor-"));
		const filePath = path.join(dir, "example.txt");
		await fs.writeFile(filePath, "one\ntwo", "utf-8");

		try {
			const editor = createEditorExecutor();

			await expect(
				editor(
					{
						path: filePath,
						new_text: "invalid",
						insert_line: 0,
					},
					dir,
					{
						agentId: "agent-1",
						conversationId: "conv-1",
						iteration: 1,
					},
				),
			).rejects.toThrow(
				"Invalid insert_line: 0. insert_line must be a positive one-based boundary line in the range 1-3. Use 3 to append at EOF.",
			);
			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("one\ntwo");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
