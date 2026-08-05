import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AgentPlugin,
	loadAgentPluginFromPath,
	resolveBundledPluginsRoot,
	syncBundledPlugins,
} from "@cline/core";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUNDLED_PLUGINS } from "./generated";
import { ensureBundledPluginsSeeded } from "./seed";

const ASSETS_ROOT = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"assets",
	"bundled-plugins",
);

function collectAssetFiles(root: string): Record<string, string> {
	const files: Record<string, string> = {};
	const stack = [root];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) {
				continue;
			}
			const entryPath = join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(entryPath);
			} else if (entry.isFile()) {
				files[relative(root, entryPath).split(sep).join("/")] = readFileSync(
					entryPath,
					"utf8",
				);
			}
		}
	}
	return files;
}

describe("bundled plugins", () => {
	it("keeps generated.ts in sync with assets/bundled-plugins (regenerate with: bun script/generate-bundled-plugins.ts)", () => {
		const assetSlugs = readdirSync(ASSETS_ROOT)
			.filter((entry) => statSync(join(ASSETS_ROOT, entry)).isDirectory())
			.sort((left, right) => left.localeCompare(right));

		expect(BUNDLED_PLUGINS.map((plugin) => plugin.slug)).toEqual(assetSlugs);
		for (const plugin of BUNDLED_PLUGINS) {
			expect(plugin.files).toEqual(
				collectAssetFiles(join(ASSETS_ROOT, plugin.slug)),
			);
		}
	});

	describe("seeding", () => {
		let root = "";
		let home = "";
		let originalHome: string | undefined;
		let originalClineDir: string | undefined;
		let originalOptOut: string | undefined;

		beforeEach(() => {
			root = mkdtempSync(join(tmpdir(), "cli-bundled-plugins-"));
			home = join(root, "home");
			originalHome = process.env.HOME;
			originalClineDir = process.env.CLINE_DIR;
			originalOptOut = process.env.CLINE_BUNDLED_PLUGINS;
			process.env.HOME = home;
			process.env.CLINE_DIR = join(home, ".cline");
			delete process.env.CLINE_BUNDLED_PLUGINS;
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
			if (originalOptOut === undefined) {
				delete process.env.CLINE_BUNDLED_PLUGINS;
			} else {
				process.env.CLINE_BUNDLED_PLUGINS = originalOptOut;
			}
			rmSync(root, { recursive: true, force: true });
		});

		it("skips seeding when CLINE_BUNDLED_PLUGINS=0", async () => {
			process.env.CLINE_BUNDLED_PLUGINS = "0";
			await ensureBundledPluginsSeeded();
			expect(existsSync(resolveBundledPluginsRoot())).toBe(false);
		});

		it("seeds the goal plugin and loads it as a valid agent plugin", {
			timeout: 30_000,
		}, async () => {
			await ensureBundledPluginsSeeded();

			const entryPath = join(resolveBundledPluginsRoot(), "goal", "index.ts");
			expect(existsSync(entryPath)).toBe(true);

			const plugin = await loadAgentPluginFromPath(entryPath);
			expect(plugin.name).toBe("goal");

			const commands: string[] = [];
			const tools: string[] = [];
			const rules: string[] = [];
			const api = {
				registerCommand: (command: { name: string }) => {
					commands.push(command.name);
				},
				registerTool: (tool: { name: string }) => {
					tools.push(tool.name);
				},
				registerRule: (rule: { id: string }) => {
					rules.push(rule.id);
				},
			} as unknown as Parameters<NonNullable<AgentPlugin["setup"]>>[0];
			await plugin.setup?.(api, {});

			expect(commands).toContain("goal");
			expect(tools).toContain("mark_goal_complete");
			expect(rules.length).toBeGreaterThan(0);
		});

		it("seeds idempotently across repeated startups", async () => {
			expect(syncBundledPlugins(BUNDLED_PLUGINS).seeded).toEqual(
				BUNDLED_PLUGINS.map((plugin) => plugin.slug),
			);
			expect(syncBundledPlugins(BUNDLED_PLUGINS).upToDate).toEqual(
				BUNDLED_PLUGINS.map((plugin) => plugin.slug),
			);
		});
	});
});
