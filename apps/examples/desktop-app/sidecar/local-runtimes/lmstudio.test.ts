import path from "node:path";
import { describe, expect, it } from "vitest";
import { isNestedDir } from "./lmstudio";

describe("isNestedDir", () => {
	const models = path.join(path.sep, "home", "me", ".lmstudio", "models");

	it("accepts folders exactly at the given depth", () => {
		expect(
			isNestedDir(
				models,
				path.join(models, "lmstudio-community", "Qwen3-8B-GGUF"),
				2,
			),
		).toBe(true);
	});

	it("rejects the models folder itself, shallower, deeper, and escaping paths", () => {
		expect(isNestedDir(models, models, 2)).toBe(false);
		expect(isNestedDir(models, path.join(models, "qwen"), 2)).toBe(false);
		expect(isNestedDir(models, path.join(models, "a", "b", "c"), 2)).toBe(
			false,
		);
		expect(isNestedDir(models, path.join(models, "..", "..", "x"), 2)).toBe(
			false,
		);
		expect(isNestedDir(models, path.join(models, "qwen", ".."), 2)).toBe(false);
	});
});
