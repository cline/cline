import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	discoverPluginModulePaths,
	getPluginDisplayName,
	setClineDir,
	setHomeDir,
} from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type BundledPluginSpec,
	getBundledPluginSlug,
	isBundledPluginInstalled,
	isBundledPluginPath,
	resolveBundledPluginsRoot,
	syncBundledPlugins,
} from "./bundled-plugins";

const GOAL_PACKAGE_JSON = JSON.stringify(
	{
		name: "goal",
		private: true,
		cline: { plugins: [{ paths: ["./index.ts"] }] },
	},
	null,
	2,
);

function goalSpec(
	indexContent = "export default { name: 'goal' };\n",
): BundledPluginSpec {
	return {
		slug: "goal",
		files: {
			"index.ts": indexContent,
			"package.json": GOAL_PACKAGE_JSON,
		},
	};
}

describe("bundled plugins service", () => {
	let root = "";
	let home = "";
	let originalHome: string | undefined;
	let originalClineDir: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "core-bundled-plugins-"));
		home = join(root, "home");
		originalHome = process.env.HOME;
		originalClineDir = process.env.CLINE_DIR;
		process.env.HOME = home;
		process.env.CLINE_DIR = join(home, ".cline");
		setHomeDir(home);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		if (originalClineDir === undefined) {
			delete process.env.CLINE_DIR;
		} else {
			process.env.CLINE_DIR = originalClineDir;
		}
		rmSync(root, { recursive: true, force: true });
	});

	it("seeds bundled plugins where regular discovery finds them", () => {
		const result = syncBundledPlugins([goalSpec()]);

		expect(result.seeded).toEqual(["goal"]);
		expect(result.failures).toEqual([]);
		const entryPath = join(resolveBundledPluginsRoot(), "goal", "index.ts");
		expect(existsSync(entryPath)).toBe(true);
		expect(isBundledPluginInstalled("goal")).toBe(true);

		const pluginsRoot = join(home, ".cline", "plugins");
		expect(discoverPluginModulePaths(pluginsRoot)).toEqual([entryPath]);
		expect(getPluginDisplayName(entryPath, pluginsRoot)).toBe("goal");
	});

	it("is idempotent and refreshes on content changes", () => {
		expect(syncBundledPlugins([goalSpec()]).seeded).toEqual(["goal"]);
		expect(syncBundledPlugins([goalSpec()]).upToDate).toEqual(["goal"]);

		const changed = goalSpec("export default { name: 'goal', v: 2 };\n");
		expect(syncBundledPlugins([changed]).updated).toEqual(["goal"]);
		const entryPath = join(resolveBundledPluginsRoot(), "goal", "index.ts");
		expect(readFileSync(entryPath, "utf8")).toContain("v: 2");
	});

	it("re-seeds when the user deletes the bundled directory", () => {
		syncBundledPlugins([goalSpec()]);
		rmSync(join(resolveBundledPluginsRoot(), "goal"), {
			recursive: true,
			force: true,
		});

		const result = syncBundledPlugins([goalSpec()]);
		expect(result.seeded).toEqual(["goal"]);
		expect(
			existsSync(join(resolveBundledPluginsRoot(), "goal", "index.ts")),
		).toBe(true);
	});

	it("defers to an existing official install of the same slug", () => {
		mkdirSync(
			join(
				home,
				".cline",
				"plugins",
				"_installed",
				"official",
				"goal-0123456789ab",
			),
			{ recursive: true },
		);

		const result = syncBundledPlugins([goalSpec()]);
		expect(result.skipped).toEqual(["goal"]);
		expect(existsSync(join(resolveBundledPluginsRoot(), "goal"))).toBe(false);
	});

	it("keeps updating a bundled plugin that was already seeded even if an official install appears later", () => {
		syncBundledPlugins([goalSpec()]);
		mkdirSync(
			join(
				home,
				".cline",
				"plugins",
				"_installed",
				"official",
				"goal-0123456789ab",
			),
			{ recursive: true },
		);

		const changed = goalSpec("export default { name: 'goal', v: 3 };\n");
		expect(syncBundledPlugins([changed]).updated).toEqual(["goal"]);
	});

	it("reports invalid specs as failures without touching disk", () => {
		const result = syncBundledPlugins([
			{ slug: "Bad Slug", files: { "index.ts": "" } },
			{ slug: "escape", files: { "../outside.ts": "" } },
			{ slug: "empty", files: {} },
		]);

		expect(result.failures.map((failure) => failure.slug)).toEqual([
			"Bad Slug",
			"escape",
			"empty",
		]);
		expect(existsSync(resolveBundledPluginsRoot())).toBe(false);
	});

	it("detects bundled plugin paths by their plugins/_bundled location", () => {
		const entryPath = join(resolveBundledPluginsRoot(), "goal", "index.ts");
		expect(isBundledPluginPath(entryPath)).toBe(true);
		expect(isBundledPluginPath(join(resolveBundledPluginsRoot(), "goal"))).toBe(
			true,
		);
		expect(getBundledPluginSlug(entryPath)).toBe("goal");

		const workspaceEntry = join(
			root,
			"workspace",
			".cline",
			"plugins",
			"_bundled",
			"goal",
			"index.ts",
		);
		expect(isBundledPluginPath(workspaceEntry)).toBe(true);

		expect(
			isBundledPluginPath(join(home, ".cline", "plugins", "goal", "index.ts")),
		).toBe(false);
		expect(
			isBundledPluginPath(
				join(home, ".cline", "plugins", "_installed", "official", "goal-x"),
			),
		).toBe(false);
		expect(isBundledPluginPath(join(home, "_bundled", "goal"))).toBe(false);
		expect(isBundledPluginPath(resolveBundledPluginsRoot())).toBe(false);
	});
});
