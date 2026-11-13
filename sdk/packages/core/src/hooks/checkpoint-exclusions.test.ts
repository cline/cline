import { describe, expect, it } from "vitest";
import {
	CHECKPOINT_DEFAULT_EXCLUDES,
	parseLfsPatterns,
} from "./checkpoint-exclusions";

describe("CHECKPOINT_DEFAULT_EXCLUDES", () => {
	it("excludes media, dependency trees, archives, and ML weights", () => {
		for (const pattern of [
			"*.mp4",
			"*.mov",
			"node_modules/",
			"*.zip",
			"*.safetensors",
			"*.gguf",
		]) {
			expect(CHECKPOINT_DEFAULT_EXCLUDES).toContain(pattern);
		}
	});

	it("does not exclude paths agents author or edit, which legacy excluded", () => {
		// Deliberate divergence from legacy: Reset Code must keep rewinding these.
		for (const pattern of [
			".vscode/",
			".idea/",
			".clinerules/",
			"bin/",
			"build/",
			"env/",
			"temp/",
			"*.lock",
			"*.svg",
		]) {
			expect(CHECKPOINT_DEFAULT_EXCLUDES).not.toContain(pattern);
		}
	});

	it("leaves data, env, and geospatial formats to a separate decision", () => {
		for (const pattern of ["*.csv", "*.sqlite", "*.env*", "*.geojson"]) {
			expect(CHECKPOINT_DEFAULT_EXCLUDES).not.toContain(pattern);
		}
	});

	it("has no duplicate patterns", () => {
		expect(new Set(CHECKPOINT_DEFAULT_EXCLUDES).size).toBe(
			CHECKPOINT_DEFAULT_EXCLUDES.length,
		);
	});
});

describe("parseLfsPatterns", () => {
	it("returns the pattern of every filter=lfs line", () => {
		expect(
			parseLfsPatterns(
				[
					"# assets",
					"*.psd filter=lfs diff=lfs merge=lfs -text",
					"assets/**\tfilter=lfs diff=lfs merge=lfs -text",
					"*.md text eol=lf",
					"",
					"*.bin -filter",
					"*.uasset filter=lfs\r",
				].join("\n"),
			),
		).toEqual(["*.psd", "assets/**", "*.uasset"]);
	});

	it("ignores filters that merely contain lfs in their name", () => {
		expect(parseLfsPatterns("*.dat filter=lfs-custom\n")).toEqual([]);
	});
});
