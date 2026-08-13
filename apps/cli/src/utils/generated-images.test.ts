import { readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeGeneratedImage } from "./generated-images";

describe("materializeGeneratedImage", () => {
	const createdDirectories: string[] = [];

	afterEach(() => {
		for (const directory of createdDirectories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("writes decoded image data to a private temporary file", () => {
		const saved = materializeGeneratedImage({
			data: Buffer.from("generated-image").toString("base64"),
			mediaType: "image/png",
		});

		expect(saved).toBeDefined();
		if (!saved) throw new Error("Expected generated image to be saved");
		createdDirectories.push(dirname(saved.path));
		expect(saved).toMatchObject({ mediaType: "image/png", byteLength: 15 });
		expect(saved.path).toMatch(/generated\.png$/);
		expect(readFileSync(saved.path, "utf8")).toBe("generated-image");
	});

	it("rejects empty or non-image payloads", () => {
		expect(
			materializeGeneratedImage({ data: "", mediaType: "image/png" }),
		).toBeUndefined();
		expect(
			materializeGeneratedImage({
				data: Buffer.from("text").toString("base64"),
				mediaType: "text/plain",
			}),
		).toBeUndefined();
	});
});
