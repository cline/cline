import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSkillPreviewArchive } from "./skill-preview-archive";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("skill preview archives", () => {
	it("decompresses the archive before reading its regular files in memory", async () => {
		const tar = Buffer.from("test tar bytes");
		const files = new Map([["skills-HEAD/SKILL.md", new Blob(["# Skill"])]]);
		const readFiles = vi.fn(async () => files);
		const Archive = vi.fn(
			class {
				files = readFiles;
				constructor(received: Uint8Array) {
					expect(Buffer.from(received)).toEqual(tar);
				}
			},
		);
		vi.stubGlobal("Bun", { Archive });

		expect(await readSkillPreviewArchive(gzipSync(tar))).toBe(files);
		expect(Archive).toHaveBeenCalledOnce();
		expect(readFiles).toHaveBeenCalledOnce();
	});

	it("rejects expanded archives over 32 MiB before reading their files", async () => {
		const Archive = vi.fn();
		vi.stubGlobal("Bun", { Archive });
		const bytes = gzipSync(Buffer.alloc(32 * 1024 * 1024 + 1));

		await expect(readSkillPreviewArchive(bytes)).rejects.toThrow(
			"repository is too large to preview",
		);
		expect(Archive).not.toHaveBeenCalled();
	});

	it("rejects malformed gzip data", async () => {
		await expect(
			readSkillPreviewArchive(Buffer.from("not a gzip archive")),
		).rejects.toThrow("invalid source archive");
	});

	it("reports malformed tar data from the native reader", async () => {
		vi.stubGlobal("Bun", {
			Archive: class {
				async files() {
					throw new Error("invalid tar header");
				}
			},
		});

		await expect(
			readSkillPreviewArchive(gzipSync(Buffer.from("not a tar archive"))),
		).rejects.toThrow("invalid source archive");
	});
});
