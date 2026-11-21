import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { webviewSourcePaths } from "./third-party-notices";

const REPO_ROOT = "/repo";

// Shape of a chunk map from `next build` with Turbopack and productionBrowserSourceMaps.
const TURBOPACK_MAP = JSON.stringify({
	version: 3,
	sources: [
		"turbopack:///[project]/node_modules/.bun/@shikijs+langs@4.4.3/node_modules/@shikijs/langs/dist/yaml.mjs",
		"turbopack:///[project]/apps/examples/desktop-app/webview/lib/desktop-client.ts",
		"turbopack:///[turbopack]/browser/runtime/base/runtime-base.ts",
	],
	sourcesContent: [],
	names: [],
	mappings: "",
	ignoreList: [0],
});

describe("webviewSourcePaths", () => {
	test("resolves [project] sources against the repo root", () => {
		expect(webviewSourcePaths(TURBOPACK_MAP, REPO_ROOT)).toEqual([
			join(
				REPO_ROOT,
				"node_modules/.bun/@shikijs+langs@4.4.3/node_modules/@shikijs/langs/dist/yaml.mjs",
			),
			join(
				REPO_ROOT,
				"apps/examples/desktop-app/webview/lib/desktop-client.ts",
			),
		]);
	});

	test("reads the sources of an index map's sections", () => {
		const indexMap = JSON.stringify({
			version: 3,
			sections: [
				{
					offset: { line: 0, column: 0 },
					map: {
						sources: ["turbopack:///[project]/node_modules/react/index.js"],
					},
				},
			],
		});
		expect(webviewSourcePaths(indexMap, REPO_ROOT)).toEqual([
			join(REPO_ROOT, "node_modules/react/index.js"),
		]);
	});

	test("recognizes nothing in an unknown source format", () => {
		const webpackMap = JSON.stringify({
			version: 3,
			sources: ["webpack://_N_E/./node_modules/react/index.js"],
		});
		expect(webviewSourcePaths(webpackMap, REPO_ROOT)).toEqual([]);
	});
});
