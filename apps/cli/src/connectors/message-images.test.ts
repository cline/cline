import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { pruneOldImageDirs, saveMessageImages } from "./message-images";

const roots: string[] = [];
function root(): string {
	const dir = mkdtempSync(join(tmpdir(), "msg-images-"));
	roots.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of roots.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe("saveMessageImages", () => {
	it("saves a photo with the extension of its type", async () => {
		const saved = await saveMessageImages({
			rootDir: root(),
			attachments: [
				{
					type: "image",
					mimeType: "image/jpeg",
					fetchData: async () => Buffer.from([1, 2]),
				},
			],
		});
		expect(saved?.paths).toHaveLength(1);
		expect(saved?.paths[0]).toMatch(/image-1\.jpg$/);
		expect(readFileSync(saved?.paths[0] ?? "")).toEqual(Buffer.from([1, 2]));
		expect(saved?.failed).toBe(0);
	});

	// Telegram sends a picture "as a file" as a document with its own type, not as a photo.
	it("takes an image sent as a file", async () => {
		const saved = await saveMessageImages({
			rootDir: root(),
			attachments: [
				{
					type: "file",
					mimeType: "image/png",
					name: "print.png",
					fetchData: async () => Buffer.from([3]),
				},
			],
		});
		expect(saved?.paths[0]).toMatch(/\.png$/);
	});

	it("ignores what is not an image, and reports nothing for a message without one", async () => {
		const fetchData = vi.fn(async () => Buffer.from([0]));
		expect(
			await saveMessageImages({
				rootDir: root(),
				attachments: [{ type: "file", mimeType: "application/pdf", fetchData }],
			}),
		).toBeUndefined();
		expect(fetchData).not.toHaveBeenCalled();
		expect(
			await saveMessageImages({ rootDir: root(), attachments: undefined }),
		).toBeUndefined();
	});

	it("counts a download that failed instead of failing", async () => {
		const saved = await saveMessageImages({
			rootDir: root(),
			attachments: [
				{
					type: "image",
					mimeType: "image/jpeg",
					fetchData: async () => Promise.reject(new Error("timeout")),
				},
			],
		});
		expect(saved).toMatchObject({ paths: [], failed: 1, refused: 0 });
	});
});

describe("pictures Kanban would refuse", () => {
	// Kanban takes png, jpg, gif and webp up to 5 MB, and refuses the whole card otherwise. An
	// iPhone photo sent as a file is image/heic; saving it as ".jpg" made the card claim a JPEG
	// it was not.
	it("does not save a type Kanban cannot attach, and counts it", async () => {
		const fetchData = vi.fn(async () => Buffer.from([1]));
		const saved = await saveMessageImages({
			rootDir: root(),
			attachments: [
				{ type: "file", mimeType: "image/heic", name: "IMG_1.HEIC", fetchData },
			],
		});
		expect(saved).toMatchObject({ paths: [], failed: 0, refused: 1 });
		expect(fetchData).not.toHaveBeenCalled();
	});

	// The size is known before downloading; refusing the picture keeps the demand, where letting
	// Kanban refuse it lost the whole card.
	it("does not download a picture over the size limit", async () => {
		const fetchData = vi.fn(async () => Buffer.from([1]));
		const saved = await saveMessageImages({
			rootDir: root(),
			attachments: [
				{
					type: "image",
					mimeType: "image/jpeg",
					size: 6 * 1024 * 1024,
					fetchData,
				},
			],
		});
		expect(saved).toMatchObject({ paths: [], refused: 1 });
		expect(fetchData).not.toHaveBeenCalled();
	});

	it("refuses a download that turns out larger than reported", async () => {
		const saved = await saveMessageImages({
			rootDir: root(),
			attachments: [
				{
					type: "image",
					mimeType: "image/png",
					fetchData: async () => Buffer.alloc(5 * 1024 * 1024 + 1),
				},
			],
		});
		expect(saved).toMatchObject({ paths: [], refused: 1 });
	});
});

describe("pruneOldImageDirs", () => {
	it("removes directories older than the limit and keeps recent ones", async () => {
		const dir = root();
		const old = join(dir, "old");
		const recent = join(dir, "recent");
		mkdirSync(old);
		mkdirSync(recent);
		const now = Date.now();
		const eightDaysAgo = (now - 8 * 24 * 3600 * 1000) / 1000;
		utimesSync(old, eightDaysAgo, eightDaysAgo);
		await pruneOldImageDirs(dir, 7 * 24 * 3600 * 1000, now);
		expect(existsSync(old)).toBe(false);
		expect(existsSync(recent)).toBe(true);
	});

	it("does nothing when the directory does not exist", async () => {
		await expect(
			pruneOldImageDirs("/nonexistent/task-images", 1),
		).resolves.toBeUndefined();
	});
});
