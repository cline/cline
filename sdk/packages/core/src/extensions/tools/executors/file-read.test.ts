import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	prepareToolResultRecovery,
	TOOL_RESULT_CACHE_MISS,
	ToolResultCache,
} from "../../../session/services/tool-result-cache";
import { createFileReadExecutor } from "./file-read";

describe("createFileReadExecutor", () => {
	it("recovers multiline MCP payloads serialized as YAML, including late line ranges", async () => {
		const payload = Array.from(
			{ length: 200 },
			(_, index) => `line ${index + 1}: ${"x".repeat(80)}`,
		).join("\n");
		const { text } = prepareToolResultRecovery({
			content: [{ type: "text", text: payload }],
			isError: false,
		});
		const cache = new ToolResultCache("session");
		const uri = cache.store("mcp-call", text ?? "") ?? "";
		const context = {
			agentId: "agent",
			iteration: 1,
			metadata: { toolResultCache: cache },
		};
		const reader = createFileReadExecutor();
		const output = String(await reader({ path: uri }, context));
		expect(output).toContain("line 200:");
		expect(output).not.toContain("[line truncated]");
		const lastLine =
			(text ?? "").split("\n").findIndex((line) => line.includes("line 200:")) +
			1;
		const lateRead = String(
			await reader(
				{ path: uri, start_line: lastLine, end_line: lastLine },
				context,
			),
		);
		expect(lateRead).toContain("line 200:");
		expect(lateRead).not.toContain("line 1:");
	});
	it("reads cache URIs with the same inclusive ranges and line numbers", async () => {
		const cache = new ToolResultCache("session");
		const uri = cache.store("call", "alpha\nbeta\ngamma\ndelta") ?? "";
		const context = {
			agentId: "agent",
			iteration: 1,
			metadata: { toolResultCache: cache },
		};
		expect(
			await createFileReadExecutor()(
				{ path: uri, start_line: 2, end_line: 3 },
				context,
			),
		).toBe("2 | beta\n3 | gamma");
		cache.clear();
		await expect(
			createFileReadExecutor()({ path: uri }, context),
		).rejects.toThrow(TOOL_RESULT_CACHE_MISS);
	});

	it("bounds cached line output and rejects cross-session or unavailable cache reads", async () => {
		const cache = new ToolResultCache("session");
		const uri = cache.store("call", `${"x".repeat(10000)}\nend`) ?? "";
		const context = {
			agentId: "agent",
			iteration: 1,
			metadata: { toolResultCache: cache },
		};
		const text = await createFileReadExecutor()({ path: uri }, context);
		expect(String(text)).toContain("[line truncated]");
		expect(String(text).length).toBeLessThan(2100);
		await expect(
			createFileReadExecutor()(
				{ path: uri },
				{
					...context,
					metadata: { toolResultCache: new ToolResultCache("other") },
				},
			),
		).rejects.toThrow("for this session");
		await expect(
			createFileReadExecutor()(
				{ path: uri },
				{ agentId: "agent", iteration: 1 },
			),
		).rejects.toThrow(TOOL_RESULT_CACHE_MISS);
	});
	it("reads a file from an absolute path", async () => {
		const result = await readTempFile("hello absolute path");
		expect(result).toBe("1 | hello absolute path");
	});

	it("returns only the requested inclusive line range", async () => {
		const result = await readTempFile("alpha\nbeta\ngamma\ndelta", {
			start_line: 2,
			end_line: 3,
		});
		expect(result).toBe("2 | beta\n3 | gamma");
	});

	async function readTempFile(
		content: string,
		range?: { start_line?: number; end_line?: number },
	): Promise<string> {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-file-read-"));
		try {
			const filePath = path.join(dir, "example.txt");
			await fs.writeFile(filePath, content, "utf-8");
			const readFile = createFileReadExecutor();
			return (await readFile(
				{ path: filePath, ...range },
				{ agentId: "agent-1", conversationId: "conv-1", iteration: 1 },
			)) as string;
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	}

	const numberedLines = (count: number) =>
		Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");

	it("windows whole-file reads to the line cap and reports how to paginate", async () => {
		const result = await readTempFile(numberedLines(2500));

		expect(result).toContain("1 | line 1");
		expect(result).toContain("2000 | line 2000");
		expect(result).not.toContain("line 2001");
		expect(result).toContain(
			"[Showing lines 1-2000 of 2500. Use start_line/end_line to read other sections.]",
		);
	});

	it("bounds line counting for unranged reads after the capture window", async () => {
		const result = await readTempFile(numberedLines(60_000));

		expect(result).toContain("1 | line 1");
		expect(result).toContain("2000 | line 2000");
		expect(result).not.toContain("line 2001");
		expect(result).toContain(
			"[Showing lines 1-2000 of 50000+ lines. Use start_line/end_line to read other sections.]",
		);
	});

	it("honors explicit ranges beyond the default window start", async () => {
		const result = await readTempFile(numberedLines(2500), {
			start_line: 2400,
			end_line: 2402,
		});

		expect(result).toBe("2400 | line 2400\n2401 | line 2401\n2402 | line 2402");
	});

	it("reports the requested finite end line when a range exceeds the line cap", async () => {
		const result = await readTempFile(numberedLines(3000), {
			start_line: 1,
			end_line: 3000,
		});

		expect(result).toContain("1 | line 1");
		expect(result).toContain("2000 | line 2000");
		expect(result).not.toContain("line 2001");
		expect(result).toContain(
			"[Showing lines 1-2000 of 3000. Use start_line/end_line to read other sections.]",
		);
	});

	it("reads a requested range from a text file larger than the size gate", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-file-read-"));
		const filePath = path.join(dir, "large.txt");
		await fs.writeFile(filePath, numberedLines(100), "utf-8");

		try {
			const readFile = createFileReadExecutor({ maxFileSizeBytes: 10 });
			const result = (await readFile(
				{ path: filePath, start_line: 50, end_line: 52 },
				{ agentId: "agent-1", conversationId: "conv-1", iteration: 1 },
			)) as string;

			expect(result).toBe("50 | line 50\n51 | line 51\n52 | line 52");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("returns a window for an unranged text file larger than the size gate", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-file-read-"));
		const filePath = path.join(dir, "large.txt");
		await fs.writeFile(filePath, numberedLines(2500), "utf-8");

		try {
			const readFile = createFileReadExecutor({ maxFileSizeBytes: 10 });
			const result = (await readFile(
				{ path: filePath },
				{ agentId: "agent-1", conversationId: "conv-1", iteration: 1 },
			)) as string;

			expect(result).toContain("1 | line 1");
			expect(result).toContain("2000 | line 2000");
			expect(result).toContain(
				"[Showing lines 1-2000 of 2500. Use start_line/end_line to read other sections.]",
			);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("truncates very long lines", async () => {
		const result = await readTempFile(`short\n${"y".repeat(5000)}\nend`);

		expect(result).toContain("short");
		expect(result).toContain("[line truncated]");
		expect(result).toContain("end");
		expect(result.length).toBeLessThan(2500);
	});

	it("rejects very large text files instead of streaming them", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-file-read-"));
		const filePath = path.join(dir, "huge.txt");
		await fs.writeFile(filePath, "hello", "utf-8");
		await fs.truncate(filePath, 100_000_001);

		try {
			const readFile = createFileReadExecutor();

			await expect(
				readFile(
					{ path: filePath, start_line: 1, end_line: 1 },
					{ agentId: "agent-1", conversationId: "conv-1", iteration: 1 },
				),
			).rejects.toThrow("Text file too large to stream safely");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("rejects when the abort signal fires before reading", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-file-read-"));
		const filePath = path.join(dir, "example.txt");
		await fs.writeFile(filePath, "hello", "utf-8");

		try {
			const controller = new AbortController();
			controller.abort(new Error("stop reading"));
			const readFile = createFileReadExecutor();

			await expect(
				readFile(
					{ path: filePath },
					{
						agentId: "agent-1",
						conversationId: "conv-1",
						iteration: 1,
						signal: controller.signal,
					},
				),
			).rejects.toThrow("stop reading");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("caps the returned window by characters for dense files", async () => {
		// 1500 lines of 100 chars each is ~150k chars, well over the ~50k cap
		// while staying under the 2000-line cap.
		const result = await readTempFile(
			Array.from({ length: 1500 }, () => "z".repeat(100)).join("\n"),
		);

		// Bounded by the read window cap; the pagination notice sits at the
		// end of the kept window, inside the tail that any downstream
		// provider-request middle-cut preserves.
		expect(result.length).toBeLessThanOrEqual(50_000);
		expect(result).toContain("of 1500. Use start_line/end_line");
	});

	it("keeps dense output capped when total line-number width grows after capture", async () => {
		const result = await readTempFile(
			Array.from({ length: 10_000 }, () => "z".repeat(100)).join("\n"),
		);

		expect(result.length).toBeLessThanOrEqual(50_000);
		expect(result).toContain("of 10000. Use start_line/end_line");
	});

	it("returns image blocks for image files when the model supports images", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-file-read-"));
		const filePath = path.join(dir, "example.png");
		const pngBytes = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
			"base64",
		);
		await fs.writeFile(filePath, pngBytes);

		try {
			const readFile = createFileReadExecutor();
			const result = await readFile(
				{ path: filePath },
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
					metadata: {
						modelSupportsImages: true,
					},
				},
			);
			expect(result).toEqual([
				{
					type: "text",
					text: "Successfully read image",
				},
				{
					type: "image",
					data: pngBytes.toString("base64"),
					mediaType: "image/png",
				},
			]);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("returns image blocks for gif files when the model supports images", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-file-read-"));
		const filePath = path.join(dir, "example.gif");
		const gifBytes = Buffer.from(
			"R0lGODdhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=",
			"base64",
		);
		await fs.writeFile(filePath, gifBytes);

		try {
			const readFile = createFileReadExecutor();
			const result = await readFile(
				{ path: filePath },
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
					metadata: {
						modelSupportsImages: true,
					},
				},
			);
			expect(result).toEqual([
				{
					type: "text",
					text: "Successfully read image",
				},
				{
					type: "image",
					data: gifBytes.toString("base64"),
					mediaType: "image/gif",
				},
			]);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("resolves macOS screenshot paths with narrow no-break space (U+202F) before PM", async () => {
		// Repro for the agent-tool side of the U+202F bug: a Cline session
		// (e.g. 1778635423953_jac9b) sent a screenshot path with a regular
		// space, but the on-disk filename contains U+202F. Without the
		// Unicode-aware resolver, fs.stat returns ENOENT and the tool fails.
		const dir = await fs.mkdtemp(
			path.join(os.tmpdir(), "agents-file-read-nnbsp-"),
		);
		const onDisk = "Screenshot 2026-05-12 at 4.42.48\u202FPM.png";
		// A 1x1 PNG so the file is valid image bytes -- the tool branches
		// on the .png extension and returns image content blocks.
		const pngBytes = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
			"base64",
		);
		await fs.writeFile(path.join(dir, onDisk), pngBytes);

		try {
			const readFile = createFileReadExecutor();
			const result = await readFile(
				// Request with a regular space instead of U+202F.
				{ path: path.join(dir, "Screenshot 2026-05-12 at 4.42.48 PM.png") },
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
					metadata: { modelSupportsImages: true },
				},
			);
			expect(result).toEqual([
				{ type: "text", text: "Successfully read image" },
				{
					type: "image",
					data: pngBytes.toString("base64"),
					mediaType: "image/png",
				},
			]);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
