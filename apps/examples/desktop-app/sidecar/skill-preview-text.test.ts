import { describe, expect, it } from "vitest";
import {
	decodeSkillPreviewText,
	isSkillPreviewPath,
	isSkillPreviewTextPath,
} from "./skill-preview-text";

describe("skill preview text policy", () => {
	it.each([
		"SKILL.md",
		"reference.MARKDOWN",
		"Dockerfile",
		".env",
		"LICENSE",
		"scripts/check.py",
	])("supports %s in either preview source", (path) =>
		expect(isSkillPreviewTextPath(path)).toBe(true));
	it.each([
		"image.png",
		"archive.zip",
		"unknown.extension",
	])("omits non-text path %s", (path) =>
		expect(isSkillPreviewTextPath(path)).toBe(false));
	it.each([
		"",
		"/absolute.md",
		"../outside.md",
		"a/../outside.md",
		"a//b.md",
		"a\\b.md",
		"a\0.md",
	])("rejects invalid preview-relative paths (%j)", (path) =>
		expect(isSkillPreviewPath(path)).toBe(false));
	it("decodes UTF-8 text while preserving formatting and removing a BOM", () => {
		expect(
			decodeSkillPreviewText(
				new TextEncoder().encode("\uFEFF# Café\r\n\ttext"),
			),
		).toBe("# Café\r\n\ttext");
	});
	it("rejects invalid UTF-8 and binary control characters", () => {
		expect(() => decodeSkillPreviewText(new Uint8Array([0xff]))).toThrow(
			"UTF-8",
		);
		expect(() => decodeSkillPreviewText(new Uint8Array([0]))).toThrow(
			"supported text",
		);
	});
});
