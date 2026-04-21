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
});
