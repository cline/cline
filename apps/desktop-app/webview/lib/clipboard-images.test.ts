// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { imageFilesFromClipboard } from "./clipboard-images";

function makeClipboardItems(
	entries: Array<{ kind: string; type: string; file: File | null }>,
): Pick<DataTransfer, "items"> {
	const items = entries.map((entry) => ({
		kind: entry.kind,
		type: entry.type,
		getAsFile: () => entry.file,
	}));
	return { items: items as unknown as DataTransferItemList };
}

describe("imageFilesFromClipboard", () => {
	it("returns image files with timestamped pasted-image names", () => {
		const png = new File(["fake"], "image.png", { type: "image/png" });
		const files = imageFilesFromClipboard(
			makeClipboardItems([{ kind: "file", type: "image/png", file: png }]),
		);

		expect(files).toHaveLength(1);
		expect(files[0].name).toMatch(/^pasted-image-.+\.png$/);
		expect(files[0].type).toBe("image/png");
	});

	it("ignores plain text and non-image files", () => {
		const doc = new File(["hello"], "notes.txt", { type: "text/plain" });
		const files = imageFilesFromClipboard(
			makeClipboardItems([
				{ kind: "string", type: "text/plain", file: null },
				{ kind: "file", type: "text/plain", file: doc },
			]),
		);

		expect(files).toHaveLength(0);
	});

	it("ignores image formats that message serialization does not support", () => {
		const bmp = new File(["fake"], "image.bmp", { type: "image/bmp" });
		const svg = new File(["<svg/>"], "image.svg", {
			type: "image/svg+xml",
		});
		const png = new File(["fake"], "image.png", { type: "image/png" });
		const files = imageFilesFromClipboard(
			makeClipboardItems([
				{ kind: "file", type: "image/bmp", file: bmp },
				{ kind: "file", type: "image/svg+xml", file: svg },
				{ kind: "file", type: "image/png", file: png },
			]),
		);

		expect(files).toHaveLength(1);
		expect(files[0].type).toBe("image/png");
		expect(files[0].name).toMatch(/^pasted-image-.+\.png$/);
	});

	it("gives multiple pasted images distinct names", () => {
		const png = new File(["a"], "image.png", { type: "image/png" });
		const jpeg = new File(["b"], "image.jpg", { type: "image/jpeg" });
		const files = imageFilesFromClipboard(
			makeClipboardItems([
				{ kind: "file", type: "image/png", file: png },
				{ kind: "file", type: "image/jpeg", file: jpeg },
			]),
		);

		expect(files).toHaveLength(2);
		expect(files[0].name).not.toBe(files[1].name);
		expect(files[1].name).toMatch(/\.jpg$/);
	});

	it("handles a missing clipboard gracefully", () => {
		expect(imageFilesFromClipboard(null)).toHaveLength(0);
	});
});
