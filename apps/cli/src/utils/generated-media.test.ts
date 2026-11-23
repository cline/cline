import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	cleanupMaterializedGeneratedMedia,
	materializeGeneratedMedia,
} from "./generated-media";

describe("materializeGeneratedMedia", () => {
	afterEach(cleanupMaterializedGeneratedMedia);

	it("writes decoded media data to a private temporary file", () => {
		const saved = materializeGeneratedMedia({
			id: "generated-1",
			modality: "image",
			mediaType: "image/png",
			source: {
				type: "base64",
				data: Buffer.from("generated-image").toString("base64"),
			},
		});

		expect(saved).toBeDefined();
		if (!saved) throw new Error("Expected generated media to be saved");
		expect(saved).toMatchObject({ mediaType: "image/png", byteLength: 15 });
		expect(saved.path).toMatch(/generated\.png$/);
		expect(readFileSync(saved.path, "utf8")).toBe("generated-image");
	});

	it("reuses the file when the same media is materialized again", () => {
		const media = {
			id: "generated-repeat",
			modality: "image" as const,
			mediaType: "image/png",
			source: { type: "base64" as const, data: "aW1hZ2U=" },
		};

		const first = materializeGeneratedMedia(media);
		const second = materializeGeneratedMedia({ ...media, id: "other" });

		expect(first?.path).toBeDefined();
		expect(second?.path).toBe(first?.path);
	});

	it("cleans up materialized media directories", () => {
		const saved = materializeGeneratedMedia({
			id: "generated-cleanup",
			modality: "audio",
			mediaType: "audio/mpeg",
			source: { type: "base64", data: "SUQz" },
		});

		expect(saved).toBeDefined();
		if (!saved) throw new Error("Expected generated media to be saved");
		const directory = dirname(saved.path);
		expect(existsSync(directory)).toBe(true);

		cleanupMaterializedGeneratedMedia();

		expect(existsSync(directory)).toBe(false);
	});

	it("rejects non-materializable payloads", () => {
		expect(
			materializeGeneratedMedia({
				id: "generated-remote",
				modality: "audio",
				mediaType: "audio/mpeg",
				source: { type: "url", url: "https://example.com/audio.mp3" },
			}),
		).toBeUndefined();
	});
});
