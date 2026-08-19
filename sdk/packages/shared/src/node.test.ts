import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFileStrippingUtf8Bom, readFileSyncStrippingUtf8Bom } from "./node";

describe("UTF-8 file readers", () => {
	const tempDirectories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempDirectories
				.splice(0)
				.map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	async function writeTempFile(content: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), "cline-utf8-file-"));
		tempDirectories.push(directory);
		const filePath = join(directory, "example.txt");
		await writeFile(filePath, content, "utf8");
		return filePath;
	}

	it("strips a leading BOM in synchronous reads", async () => {
		const filePath = await writeTempFile("\uFEFFcontent");

		expect(readFileSyncStrippingUtf8Bom(filePath)).toBe("content");
	});

	it("strips a leading BOM in asynchronous reads", async () => {
		const filePath = await writeTempFile("\uFEFFcontent");

		await expect(readFileStrippingUtf8Bom(filePath)).resolves.toBe("content");
	});

	it("preserves interior BOM characters", async () => {
		const filePath = await writeTempFile("a\uFEFFb");

		expect(readFileSyncStrippingUtf8Bom(filePath)).toBe("a\uFEFFb");
		await expect(readFileStrippingUtf8Bom(filePath)).resolves.toBe("a\uFEFFb");
	});
});
