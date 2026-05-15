import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createFileReadExecutor } from "./file-read";

describe("createFileReadExecutor", () => {
	it("reads a file from an absolute path", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-file-read-"));
		const filePath = path.join(dir, "example.txt");
		await fs.writeFile(filePath, "hello absolute path", "utf-8");

		try {
			const readFile = createFileReadExecutor();
			const result = await readFile(
				{ path: filePath },
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
				},
			);
			expect(result).toBe("1 | hello absolute path");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("returns only the requested inclusive line range", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-file-read-"));
		const filePath = path.join(dir, "example.txt");
		await fs.writeFile(filePath, "alpha\nbeta\ngamma\ndelta", "utf-8");

		try {
			const readFile = createFileReadExecutor();
			const result = await readFile(
				{ path: filePath, start_line: 2, end_line: 3 },
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
				},
			);
			expect(result).toBe("2 | beta\n3 | gamma");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
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
