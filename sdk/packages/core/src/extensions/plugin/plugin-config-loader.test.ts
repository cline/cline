import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHomeDir } from "@clinebot/shared/storage";
import { afterEach, describe, expect, it } from "vitest";
import {
	discoverPluginModulePaths,
	resolveAgentPluginPaths,
	resolvePluginConfigSearchPaths,
} from "./plugin-config-loader";

describe("plugin-config-loader", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
	};

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME;
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
			const workspacePlugins = join(workspace, ".clinerules", "plugins");
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
});
