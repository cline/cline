import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
	readImageDataUrlFromPastedText,
	readImmediateImagePasteAttachment,
	resolvePastedImagePath,
} from "./image-paste";

describe("image paste helpers", () => {
	it("loads pasted image file paths as data urls", () => {
		const dir = mkdtempSync(join(tmpdir(), "cli image paste "));
		const imagePath = join(dir, "hero.png");
		writeFileSync(imagePath, Buffer.from("hello"));

		const result = readImageDataUrlFromPastedText(`"${imagePath}"`);

		expect(result).toEqual({
			dataUrl: "data:image/png;base64,aGVsbG8=",
			source: "path",
		});
	});

	it("resolves file url paste paths", () => {
		const dir = mkdtempSync(join(tmpdir(), "cli-image-paste-"));
		const imagePath = join(dir, "hero.png");

		expect(resolvePastedImagePath(pathToFileURL(imagePath).href)).toBe(
			imagePath,
		);
	});

	it("decodes direct image paste bytes when metadata is available", () => {
		const event = {
			bytes: Buffer.from("hello"),
			metadata: { mimeType: "image/png" },
		};

		expect(readImmediateImagePasteAttachment(event)).toEqual({
			dataUrl: "data:image/png;base64,aGVsbG8=",
			source: "paste",
		});
	});

	it("loads macOS screenshot paths when narrow no-break space is normalized to a regular space", () => {
		// macOS Sonoma+ embeds U+202F (NARROW NO-BREAK SPACE) before AM/PM
		// in screenshot filenames. When the path travels through clipboards,
		// terminals, or anything that normalizes whitespace, U+202F can be
		// collapsed to a regular space (U+0020) -- but the on-disk filename
		// still contains U+202F, so a literal readFileSync fails with ENOENT.
		const dir = mkdtempSync(join(tmpdir(), "cli-image-paste-nnbsp-"));
		const onDiskName = "Screenshot 2026-05-12 at 4.42.48\u202FPM.png";
		const pastedName = "Screenshot 2026-05-12 at 4.42.48 PM.png";
		const onDiskPath = join(dir, onDiskName);
		writeFileSync(onDiskPath, Buffer.from("hello"));

		const result = readImageDataUrlFromPastedText(join(dir, pastedName));

		expect(result).toEqual({
			dataUrl: "data:image/png;base64,aGVsbG8=",
			source: "path",
		});
	});

	it("loads paths when an arbitrary Unicode space differs from the on-disk filename", () => {
		// Generalized variant: any exotic space (here U+00A0 NBSP) in the
		// actual filename should still resolve when the pasted text uses a
		// regular space.
		const dir = mkdtempSync(join(tmpdir(), "cli-image-paste-nbsp-"));
		const onDiskName = "weird\u00a0name.png";
		const pastedName = "weird name.png";
		writeFileSync(join(dir, onDiskName), Buffer.from("hello"));

		const result = readImageDataUrlFromPastedText(join(dir, pastedName));

		expect(result).toEqual({
			dataUrl: "data:image/png;base64,aGVsbG8=",
			source: "path",
		});
	});
});
