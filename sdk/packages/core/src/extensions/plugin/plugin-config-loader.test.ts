import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHomeDir } from "@cline/shared/storage";
import { afterEach, describe, expect, it } from "vitest";
import {
	discoverPluginModulePaths,
	resolveAgentPluginPaths,
	resolveAgentPluginSkillDirectories,
	resolveAndLoadAgentPlugins,
	resolvePluginConfigSearchPaths,
	resolvePluginSkillDirectoriesFromPaths,
} from "./plugin-config-loader";

describe("plugin-config-loader", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_GLOBAL_SETTINGS_PATH: process.env.CLINE_GLOBAL_SETTINGS_PATH,
	};

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME;
		process.env.CLINE_GLOBAL_SETTINGS_PATH =
			envSnapshot.CLINE_GLOBAL_SETTINGS_PATH;
		setHomeDir(envSnapshot.HOME ?? "~");
	});

	it("discovers plugin modules recursively", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-plugin-config-loader-"));
		try {
			const nested = join(root, "nested");
			await mkdir(nested, { recursive: true });
			await writeFile(join(root, "a.js"), "export default {}", "utf8");
			await writeFile(join(nested, "b.ts"), "export default {}", "utf8");
			await writeFile(
				join(root, ".a.js.cline-plugin.js"),
				"export default {}",
				"utf8",
			);
			await writeFile(join(root, "ignore.txt"), "noop", "utf8");

			const discovered = discoverPluginModulePaths(root);
			expect(discovered).toEqual([join(root, "a.js"), join(nested, "b.ts")]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("resolves plugin paths from explicit files/directories", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-plugin-config-loader-"));
		try {
			process.env.HOME = root;
			setHomeDir(root);
			const pluginsDir = join(root, "plugins");
			await mkdir(pluginsDir, { recursive: true });
			const filePath = join(root, "direct.js");
			const dirPluginPath = join(pluginsDir, "dir-plugin.js");
			await writeFile(filePath, "export default {}", "utf8");
			await writeFile(dirPluginPath, "export default {}", "utf8");

			const resolved = resolveAgentPluginPaths({
				pluginPaths: ["./direct.js", "./plugins"],
				workspacePath: join(root, "workspace"),
				cwd: root,
			});

			expect(resolved).toEqual([filePath, dirPluginPath]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("prefers package manifest plugin entries for configured directories", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-plugin-config-loader-"));
		try {
			process.env.HOME = root;
			setHomeDir(root);
			const pluginDir = join(root, "plugin-package");
			const srcDir = join(pluginDir, "src");
			await mkdir(srcDir, { recursive: true });
			const declaredEntry = join(srcDir, "index.ts");
			const ignoredEntry = join(pluginDir, "ignored.js");
			await writeFile(
				join(pluginDir, "package.json"),
				JSON.stringify({
					name: "plugin-package",
					private: true,
					cline: {
						plugins: [
							{
								paths: ["./src/index.ts"],
								capabilities: ["tools"],
							},
						],
					},
				}),
				"utf8",
			);
			await writeFile(declaredEntry, "export default {}", "utf8");
			await writeFile(ignoredEntry, "export default {}", "utf8");

			const resolved = resolveAgentPluginPaths({
				pluginPaths: ["./plugin-package"],
				cwd: root,
				workspacePath: join(root, "workspace"),
			});

			expect(resolved).toContain(declaredEntry);
			expect(resolved).not.toContain(ignoredEntry);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("resolves bundled skill directories from configured plugin packages", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-plugin-config-loader-"));
		try {
			process.env.HOME = root;
			setHomeDir(root);
			const pluginDir = join(root, "plugin-package");
			const srcDir = join(pluginDir, "src");
			const skillDir = join(pluginDir, "skills", "review");
			await mkdir(srcDir, { recursive: true });
			await mkdir(skillDir, { recursive: true });
			await writeFile(
				join(pluginDir, "package.json"),
				JSON.stringify({
					name: "plugin-package",
					private: true,
					cline: {
						plugins: [
							{
								paths: ["./src/index.ts"],
								capabilities: ["tools"],
							},
						],
					},
				}),
				"utf8",
			);
			await writeFile(join(srcDir, "index.ts"), "export default {}", "utf8");
			await writeFile(
				join(skillDir, "SKILL.md"),
				"---\nname: review\n---\nReview skill.",
				"utf8",
			);

			const resolved = resolveAgentPluginSkillDirectories({
				pluginPaths: ["./plugin-package"],
				cwd: root,
				workspacePath: join(root, "workspace"),
			});

			expect(resolved).toEqual([join(pluginDir, "skills")]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("skips missing configured plugin paths while resolving bundled skill directories", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-plugin-config-loader-"));
		try {
			process.env.HOME = root;
			setHomeDir(root);
			const pluginDir = join(root, "plugin-package");
			const srcDir = join(pluginDir, "src");
			const skillDir = join(pluginDir, "skills", "review");
			await mkdir(srcDir, { recursive: true });
			await mkdir(skillDir, { recursive: true });
			await writeFile(
				join(pluginDir, "package.json"),
				JSON.stringify({
					name: "plugin-package",
					private: true,
					cline: {
						plugins: [
							{
								paths: ["./src/index.ts"],
								capabilities: ["tools"],
							},
						],
					},
				}),
				"utf8",
			);
			await writeFile(join(srcDir, "index.ts"), "export default {}", "utf8");
			await writeFile(
				join(skillDir, "SKILL.md"),
				"---\nname: review\n---\nReview skill.",
				"utf8",
			);

			const resolved = resolveAgentPluginSkillDirectories({
				pluginPaths: ["./missing-plugin", "./plugin-package"],
				cwd: root,
				workspacePath: join(root, "workspace"),
			});

			expect(resolved).toEqual([join(pluginDir, "skills")]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("resolves bundled skill directories from active plugin paths", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-plugin-config-loader-"));
		try {
			const pluginDir = join(root, "plugin-package");
			const srcDir = join(pluginDir, "src");
			const skillDir = join(pluginDir, "skills", "review");
			await mkdir(srcDir, { recursive: true });
			await mkdir(skillDir, { recursive: true });
			await writeFile(
				join(pluginDir, "package.json"),
				JSON.stringify({
					name: "plugin-package",
					private: true,
					cline: {
						plugins: [{ paths: ["./src/index.ts"] }],
					},
				}),
				"utf8",
			);
			const pluginPath = join(srcDir, "index.ts");
			await writeFile(pluginPath, "export default {}", "utf8");
			await writeFile(
				join(skillDir, "SKILL.md"),
				"---\nname: review\n---\nReview skill.",
				"utf8",
			);

			expect(resolvePluginSkillDirectoriesFromPaths([pluginPath])).toEqual([
				join(pluginDir, "skills"),
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not resolve ancestor skills from unrelated package roots", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-plugin-config-loader-"));
		try {
			const pluginSrcDir = join(root, "packages", "myplugin", "src");
			const rootSkillDir = join(root, "skills", "private-root-skill");
			await mkdir(pluginSrcDir, { recursive: true });
			await mkdir(rootSkillDir, { recursive: true });
			await writeFile(
				join(root, "package.json"),
				JSON.stringify({
					name: "monorepo-root",
					private: true,
				}),
				"utf8",
			);
			const pluginPath = join(pluginSrcDir, "index.ts");
			await writeFile(pluginPath, "export default {}", "utf8");
			await writeFile(
				join(rootSkillDir, "SKILL.md"),
				"---\nname: private-root-skill\n---\nPrivate root skill.",
				"utf8",
			);

			expect(resolvePluginSkillDirectoriesFromPaths([pluginPath])).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("resolves bundled skill directories from installed plugin wrappers", async () => {
		const home = await mkdtemp(
			join(tmpdir(), "core-plugin-config-loader-home-"),
		);
		const workspace = await mkdtemp(
			join(tmpdir(), "core-plugin-config-loader-workspace-"),
		);
		try {
			process.env.HOME = home;
			setHomeDir(home);
			const installRoot = join(
				workspace,
				".cline",
				"plugins",
				"_installed",
				"local",
				"demo",
			);
			const packageRoot = join(installRoot, "package");
			const skillDir = join(packageRoot, "skills", "review");
			await mkdir(skillDir, { recursive: true });
			await writeFile(
				join(installRoot, "package.json"),
				JSON.stringify({
					name: "cline-installed-plugin-demo",
					private: true,
					cline: {
						plugins: [{ paths: ["./package/index.ts"] }],
					},
				}),
				"utf8",
			);
			await writeFile(
				join(packageRoot, "index.ts"),
				"export default {}",
				"utf8",
			);
			await writeFile(
				join(skillDir, "SKILL.md"),
				"---\nname: review\n---\nReview skill.",
				"utf8",
			);

			const resolved = resolveAgentPluginSkillDirectories({
				workspacePath: workspace,
				cwd: workspace,
			});

			expect(resolved).toEqual([join(packageRoot, "skills")]);
		} finally {
			await rm(home, { recursive: true, force: true });
			await rm(workspace, { recursive: true, force: true });
		}
	});

	it("includes shared search-path plugins", async () => {
		const home = await mkdtemp(
			join(tmpdir(), "core-plugin-config-loader-home-"),
		);
		const workspace = await mkdtemp(
			join(tmpdir(), "core-plugin-config-loader-workspace-"),
		);
		try {
			process.env.HOME = home;
			setHomeDir(home);
			const workspacePlugins = join(workspace, ".cline", "plugins");
			const userPlugins = join(home, ".cline", "plugins");
			const documentsPlugins = join(home, "Documents", "Cline", "Plugins");
			await mkdir(workspacePlugins, { recursive: true });
			await mkdir(userPlugins, { recursive: true });
			await mkdir(documentsPlugins, { recursive: true });
			const workspacePlugin = join(workspacePlugins, "workspace.js");
			const userPlugin = join(userPlugins, "user.js");
			const documentsPlugin = join(documentsPlugins, "documents.js");
			await writeFile(workspacePlugin, "export default {}", "utf8");
			await writeFile(userPlugin, "export default {}", "utf8");
			await writeFile(documentsPlugin, "export default {}", "utf8");

			const searchPaths = resolvePluginConfigSearchPaths(workspace);
			expect(searchPaths).toHaveLength(3);
			expect(searchPaths).toContain(workspacePlugins);
			expect(searchPaths).toContain(userPlugins);
			expect(searchPaths).toContain(documentsPlugins);

			const resolved = resolveAgentPluginPaths({ workspacePath: workspace });
			expect(resolved).toContain(workspacePlugin);
			expect(resolved).toContain(userPlugin);
			expect(resolved).toContain(documentsPlugin);
		} finally {
			await rm(home, { recursive: true, force: true });
			await rm(workspace, { recursive: true, force: true });
		}
	});

	it("omits plugins disabled in global settings", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-plugin-config-loader-"));
		try {
			process.env.HOME = root;
			setHomeDir(root);
			const enabledPlugin = join(root, "enabled.js");
			const disabledPlugin = join(root, "disabled.js");
			const settingsPath = join(root, "global-settings.json");
			process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;
			await writeFile(enabledPlugin, "export default {}", "utf8");
			await writeFile(disabledPlugin, "export default {}", "utf8");
			await writeFile(
				settingsPath,
				JSON.stringify({ disabledPlugins: [disabledPlugin] }, null, 2),
				"utf8",
			);

			const resolved = resolveAgentPluginPaths({
				pluginPaths: [enabledPlugin, disabledPlugin],
				cwd: root,
			});

			expect(resolved).toEqual([enabledPlugin]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("loads valid plugins while reporting failures and duplicate overrides", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-plugin-config-loader-"));
		try {
			process.env.HOME = root;
			setHomeDir(root);
			const first = join(root, "duplicate-one.js");
			const second = join(root, "duplicate-two.js");
			const invalid = join(root, "invalid.js");
			await writeFile(
				first,
				"export default { name: 'duplicate-plugin', manifest: { capabilities: ['tools'] } };",
				"utf8",
			);
			await writeFile(
				second,
				"export default { name: 'duplicate-plugin', manifest: { capabilities: ['commands'] } };",
				"utf8",
			);
			await writeFile(invalid, "export default { name: 'broken' };", "utf8");

			const loaded = await resolveAndLoadAgentPlugins({
				mode: "in_process",
				pluginPaths: [first, invalid, second],
				cwd: root,
			});

			// Filter to only our test plugins to ignore any discovered system plugins
			const testPlugins = loaded.extensions.filter(
				(plugin) => plugin.name === "duplicate-plugin",
			);
			expect(testPlugins).toHaveLength(1);
			expect(testPlugins[0]?.manifest.capabilities).toEqual(["commands"]);
			expect(loaded.pluginPaths).toEqual([second]);
			expect(loaded.failures).toHaveLength(1);
			expect(loaded.warnings).toHaveLength(1);
			expect(loaded.warnings[0]?.overriddenPluginPath).toBe(first);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("reports only provider and model compatible active plugin paths", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-plugin-config-loader-"));
		try {
			process.env.HOME = root;
			setHomeDir(root);
			const compatible = join(root, "compatible.js");
			const incompatible = join(root, "incompatible.js");
			await writeFile(
				compatible,
				`export default {
	name: 'compatible-plugin',
	manifest: {
		capabilities: ['tools'],
		providerIds: ['cline'],
		modelIds: ['anthropic/claude-haiku-4.5']
	}
};`,
				"utf8",
			);
			await writeFile(
				incompatible,
				`export default {
	name: 'incompatible-plugin',
	manifest: {
		capabilities: ['tools'],
		providerIds: ['openai'],
		modelIds: ['gpt-5.4']
	}
};`,
				"utf8",
			);

			const loaded = await resolveAndLoadAgentPlugins({
				mode: "in_process",
				pluginPaths: [compatible, incompatible],
				cwd: root,
				providerId: "cline",
				modelId: "anthropic/claude-haiku-4.5",
			});

			expect(loaded.extensions.map((plugin) => plugin.name)).toEqual([
				"compatible-plugin",
			]);
			expect(loaded.pluginPaths).toEqual([compatible]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
