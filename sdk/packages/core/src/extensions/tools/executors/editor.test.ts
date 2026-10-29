import { existsSync, readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createEditorExecutor } from "./editor";

vi.mock("node:fs/promises", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...original,
		access: vi.fn(original.access),
		readFile: vi.fn(original.readFile),
	};
});

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
	it("preserves concurrent replacements through absolute and relative paths", async () => {
		await withTempFile("alpha: old\nbeta: old\n", async (filePath, dir) => {
			const editor = createEditorExecutor();
			const access = vi.mocked(fs.access).mockResolvedValue(undefined);
			const read = vi.mocked(fs.readFile).mockImplementation(async () => {
				const snapshot = readFileSync(filePath, "utf-8");
				await Promise.resolve();
				return snapshot;
			});
			try {
				const results = await Promise.all([
					editor(
						{ path: filePath, old_text: "alpha: old", new_text: "alpha: new" },
						dir,
						context,
					),
					editor(
						{
							path: "./example.txt",
							old_text: "beta: old",
							new_text: "beta: new",
						},
						dir,
						context,
					),
				]);
				expect(
					results.every((result) => result.startsWith(`Edited ${filePath}`)),
				).toBe(true);
			} finally {
				read.mockRestore();
				access.mockRestore();
			}
			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
				"alpha: new\nbeta: new\n",
			);
		});
	});

	it("serializes edits from different executor instances to the same file", async () => {
		await withTempFile("alpha: old\nbeta: old\n", async (filePath, dir) => {
			const firstEditor = createEditorExecutor();
			const secondEditor = createEditorExecutor();
			const alternatePath =
				process.platform === "win32" ? filePath.toUpperCase() : "./example.txt";
			const access = vi.mocked(fs.access).mockResolvedValue(undefined);
			const read = vi.mocked(fs.readFile).mockImplementation(async () => {
				const snapshot = readFileSync(filePath, "utf-8");
				await Promise.resolve();
				return snapshot;
			});
			try {
				await Promise.all([
					firstEditor(
						{ path: filePath, old_text: "alpha: old", new_text: "alpha: new" },
						dir,
						context,
					),
					secondEditor(
						{
							path: alternatePath,
							old_text: "beta: old",
							new_text: "beta: new",
						},
						dir,
						context,
					),
				]);
			} finally {
				read.mockRestore();
				access.mockRestore();
			}
			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
				"alpha: new\nbeta: new\n",
			);
		});
	});

	it("does not block edits to different files", async () => {
		await withTempFile("first: old", async (filePath, dir) => {
			const secondPath = path.join(dir, "second.txt");
			await fs.writeFile(secondPath, "second: old", "utf-8");
			const editor = createEditorExecutor();
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
				if (String(file) === filePath) {
					startFirstRead();
					await firstReadReleased;
				}
				return snapshot;
			});
			const first = editor(
				{ path: filePath, old_text: "first: old", new_text: "first: new" },
				dir,
				context,
			);
			await firstReadStarted;
			const second = editor(
				{ path: secondPath, old_text: "second: old", new_text: "second: new" },
				dir,
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
				).resolves.toContain(`Edited ${secondPath}`);
			} finally {
				if (timer) clearTimeout(timer);
				releaseFirstRead();
				await Promise.allSettled([first, second]);
				read.mockRestore();
			}
			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("first: new");
			await expect(fs.readFile(secondPath, "utf-8")).resolves.toBe(
				"second: new",
			);
		});
	});

	it("continues queued edits after a failed edit", async () => {
		await withTempFile("alpha: old\nbeta: old", async (filePath, dir) => {
			const editor = createEditorExecutor();
			const failed = editor(
				{ path: filePath, old_text: "missing", new_text: "ignored" },
				dir,
				context,
			);
			const next = editor(
				{ path: filePath, old_text: "alpha: old", new_text: "alpha: new" },
				dir,
				context,
			);
			await Promise.all([
				expect(failed).rejects.toThrow(
					"No replacement performed: text not found",
				),
				expect(next).resolves.toContain(`Edited ${filePath}`),
			]);
			await editor(
				{ path: filePath, old_text: "beta: old", new_text: "beta: new" },
				dir,
				context,
			);
			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
				"alpha: new\nbeta: new",
			);
		});
	});

	it("preserves concurrent insertions and replacements", async () => {
		await withTempFile("one\ntwo", async (filePath, dir) => {
			const editor = createEditorExecutor();
			const access = vi.mocked(fs.access).mockResolvedValue(undefined);
			const read = vi.mocked(fs.readFile).mockImplementation(async () => {
				const snapshot = readFileSync(filePath, "utf-8");
				await Promise.resolve();
				return snapshot;
			});
			try {
				await Promise.all([
					editor(
						{ path: filePath, insert_line: 2, new_text: "inserted" },
						dir,
						context,
					),
					editor(
						{ path: filePath, old_text: "two", new_text: "TWO" },
						dir,
						context,
					),
				]);
			} finally {
				read.mockRestore();
				access.mockRestore();
			}
			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
				"one\ninserted\nTWO",
			);
		});
	});

	it("checks existence after an earlier queued creation", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-editor-"));
		const filePath = path.join(dir, "new.txt");
		const access = vi.mocked(fs.access).mockImplementation(async (file) => {
			const exists = existsSync(String(file));
			await Promise.resolve();
			if (!exists) throw new Error("File does not exist");
		});
		try {
			const editor = createEditorExecutor();
			const [created, edited] = await Promise.all([
				editor({ path: filePath, new_text: "created" }, dir, context),
				editor(
					{ path: filePath, old_text: "created", new_text: "edited" },
					dir,
					context,
				),
			]);
			expect(created).toBe(`File created successfully at: ${filePath}`);
			expect(edited).toContain(`Edited ${filePath}`);
			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("edited");
		} finally {
			access.mockRestore();
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

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
			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("a\nB\ne\nf");
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

			expect(result).toBe(`Edited ${filePath}\n\`\`\`diff\n+2: new\n\`\`\``);
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

	it("preserves CRLF line endings when inserting LF-only text into a CRLF file", async () => {
		await withTempFile("one\r\ntwo\r\nthree", async (filePath, dir) => {
			const editor = createEditorExecutor();
			await editor(
				{
					path: filePath,
					new_text: "first\nsecond",
					insert_line: 2,
				},
				dir,
				context,
			);

			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
				"one\r\nfirst\r\nsecond\r\ntwo\r\nthree",
			);
		});
	});

	it("replaces multi-line LF old_text in a CRLF file and keeps CRLF endings", async () => {
		await withTempFile("a\r\nb\r\nc\r\nd", async (filePath, dir) => {
			const editor = createEditorExecutor();
			// Reads strip "\r", so the model round-trips LF-only text even
			// though the file on disk is CRLF.
			const result = await editor(
				{ path: filePath, old_text: "b\nc", new_text: "B\nC\nX" },
				dir,
				context,
			);

			expect(result).toBe(
				`Edited ${filePath}\n\`\`\`diff\n-2: b\n-3: c\n+2: B\n+3: C\n+4: X\n\`\`\``,
			);
			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
				"a\r\nB\r\nC\r\nX\r\nd",
			);
		});
	});

	// The CRLF branch is exercised for real by Windows CI, where os.EOL is
	// "\r\n" (github.com/cline/cline/issues/13504).
	it("creates new files with the platform-native line ending", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-editor-"));
		const filePath = path.join(dir, "fresh.txt");

		try {
			const editor = createEditorExecutor();
			await editor(
				{ path: filePath, new_text: "one\ntwo\nthree" },
				dir,
				context,
			);

			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
				["one", "two", "three"].join(os.EOL),
			);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("replaces text in a pure-LF file without introducing CRLF", async () => {
		await withTempFile("a\nb\nc", async (filePath, dir) => {
			const editor = createEditorExecutor();
			await editor(
				{ path: filePath, old_text: "b\nc", new_text: "B\r\nC" },
				dir,
				context,
			);

			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("a\nB\nC");
		});
	});

	it("inserts $-sequences in new_text literally", async () => {
		await withTempFile("a\nb\nc", async (filePath, dir) => {
			const editor = createEditorExecutor();
			await editor(
				{
					path: filePath,
					old_text: "b",
					new_text: "cost=$100 pid=$$ match=$& rest=$'",
				},
				dir,
				context,
			);

			await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
				"a\ncost=$100 pid=$$ match=$& rest=$'\nc",
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
