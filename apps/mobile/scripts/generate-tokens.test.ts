import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	buildThemes,
	emitTokensModule,
	renderTokensModule,
	sha256,
	THEME_CSS_PATH,
	THEME_SHA_PATH,
	TOKENS_PATH,
} from "./lib/css-tokens";

describe("token pipeline drift guards", () => {
	it("the recorded sha256 matches the vendored css", () => {
		const recorded = readFileSync(THEME_SHA_PATH, "utf8").trim();
		expect(recorded).toMatch(/^[0-9a-f]{64}$/);
		expect(sha256(readFileSync(THEME_CSS_PATH))).toBe(recorded);
	});

	it("regenerating from unchanged input is a no-op diff", () => {
		const { source } = renderTokensModule();
		expect(readFileSync(TOKENS_PATH, "utf8")).toBe(source);
	});

	it("regenerating twice in a row produces byte-identical output", () => {
		expect(renderTokensModule().source).toBe(renderTokensModule().source);
	});

	it("notices when the input css changes", () => {
		const css = readFileSync(THEME_CSS_PATH, "utf8");
		const mutated = css.replace(
			"--cline-radius-md: 0.5rem;",
			"--cline-radius-md: 0.625rem;",
		);
		expect(mutated).not.toBe(css);
		expect(emitTokensModule(buildThemes(mutated), sha256(mutated))).not.toBe(
			renderTokensModule().source,
		);
	});
});
