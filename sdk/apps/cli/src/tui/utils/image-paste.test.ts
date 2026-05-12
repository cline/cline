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
});
