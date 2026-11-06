import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = join(import.meta.dirname, "..");

async function readPackageFile(path: string): Promise<string> {
	return readFile(join(packageRoot, path), "utf8");
}

describe("@cline/shared/testing", () => {
	it("is published as its own subpath and build entrypoint", async () => {
		const manifest = JSON.parse(await readPackageFile("package.json"));

		expect(manifest.exports["./testing"]).toEqual({
			types: "./dist/testing.d.ts",
			import: "./dist/testing.js",
		});
		expect(await readPackageFile("bun.mts")).toContain('"./src/testing.ts"');
	});

	it("exports the fixtures from dist/testing.js and from neither barrel", async () => {
		const testing = await import(join(packageRoot, "dist/testing.js"));

		expect(
			testing.PLUGIN_UI_FIXTURES.composerSuggestions.readyOne,
		).toMatchObject({
			status: "ready",
		});
		for (const barrel of ["dist/index.js", "dist/index.browser.js"]) {
			const bundle = await readPackageFile(barrel);
			expect(bundle).toContain("normalizePluginUiState");
			expect(bundle).not.toContain("PLUGIN_UI_FIXTURES");
			expect(bundle).not.toContain("steal()");
		}
	});
});
