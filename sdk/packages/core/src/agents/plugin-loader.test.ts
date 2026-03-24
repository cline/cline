import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	loadAgentPluginFromPath,
	loadAgentPluginsFromPaths,
} from "./plugin-loader";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "..", "..", "..", "..");

describe("plugin-loader", () => {
	it("loads default-exported plugin from path", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-loader-"));
		try {
			const pluginPath = join(dir, "plugin-default.mjs");
			await writeFile(
				pluginPath,
				[
					"export default {",
					"  name: 'from-default',",
					"  manifest: { capabilities: ['hooks'], hookStages: ['input'] },",
					"  onInput: ({ input }) => ({ overrideInput: input })",
					"};",
				].join("\n"),
				"utf8",
			);

			const plugin = await loadAgentPluginFromPath(pluginPath);
			expect(plugin.name).toBe("from-default");
			expect(plugin.manifest.capabilities).toContain("hooks");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("loads named plugin export from path", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-loader-"));
		try {
			const pluginPath = join(dir, "plugin-named.mjs");
			await writeFile(
				pluginPath,
				[
					"export const plugin = {",
					"  name: 'from-named',",
					"  manifest: { capabilities: ['tools'] },",
					"};",
				].join("\n"),
				"utf8",
			);

			const plugin = await loadAgentPluginFromPath(pluginPath, {
				exportName: "plugin",
			});
			expect(plugin.name).toBe("from-named");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("loads multiple plugins from file paths", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-loader-"));
		try {
			const firstPath = join(dir, "plugin-a.mjs");
			const secondPath = join(dir, "plugin-b.mjs");
			await writeFile(
				firstPath,
				"export default { name: 'plugin-a', manifest: { capabilities: ['tools'] } };",
				"utf8",
			);
			await writeFile(
				secondPath,
				"export default { name: 'plugin-b', manifest: { capabilities: ['commands'] } };",
				"utf8",
			);

			const plugins = await loadAgentPluginsFromPaths([firstPath, secondPath]);
			expect(plugins.map((plugin) => plugin.name)).toEqual([
				"plugin-a",
				"plugin-b",
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("loads TypeScript plugins from file paths", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-loader-"));
		try {
			const pluginPath = join(dir, "plugin-ts.ts");
			await writeFile(
				pluginPath,
				[
					"const name: string = 'plugin-ts';",
					"export default {",
					"  name,",
					"  manifest: { capabilities: ['tools'] },",
					"};",
				].join("\n"),
				"utf8",
			);

			const plugin = await loadAgentPluginFromPath(pluginPath);
			expect(plugin.name).toBe("plugin-ts");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("resolves plugin-local dependencies from the plugin path", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-loader-"));
		try {
			const depDir = join(dir, "node_modules", "plugin-local-dep");
			await mkdir(depDir, { recursive: true });
			await writeFile(
				join(depDir, "package.json"),
				JSON.stringify({
					name: "plugin-local-dep",
					type: "module",
					exports: "./index.js",
				}),
				"utf8",
			);
			await writeFile(
				join(depDir, "index.js"),
				"export const depName = 'plugin-local-dep';\n",
				"utf8",
			);
			const pluginPath = join(dir, "plugin-with-dep.ts");
			await writeFile(
				pluginPath,
				[
					"import { depName } from 'plugin-local-dep';",
					"export default {",
					"  name: depName,",
					"  manifest: { capabilities: ['tools'] },",
					"};",
				].join("\n"),
				"utf8",
			);

			const plugin = await loadAgentPluginFromPath(pluginPath, { cwd: dir });
			expect(plugin.name).toBe("plugin-local-dep");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("prefers plugin-installed SDK packages over workspace aliases", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-loader-"));
		try {
			const depDir = join(dir, "node_modules", "@clinebot", "shared");
			await mkdir(depDir, { recursive: true });
			await writeFile(
				join(depDir, "package.json"),
				JSON.stringify({
					name: "@clinebot/shared",
					type: "module",
					exports: "./index.js",
				}),
				"utf8",
			);
			await writeFile(
				join(depDir, "index.js"),
				"export const sdkMarker = 'plugin-installed-sdk';\n",
				"utf8",
			);
			const pluginPath = join(dir, "plugin-with-sdk-dep.ts");
			await writeFile(
				pluginPath,
				[
					"import { sdkMarker } from '@clinebot/shared';",
					"export default {",
					"  name: sdkMarker,",
					"  manifest: { capabilities: ['tools'] },",
					"};",
				].join("\n"),
				"utf8",
			);

			const plugin = await loadAgentPluginFromPath(pluginPath, { cwd: dir });
			expect(plugin.name).toBe("plugin-installed-sdk");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("requires copied plugins to provide their own non-SDK dependencies", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-loader-copy-"));
		try {
			const pluginPath = join(dir, "portable-subagents.ts");
			await writeFile(
				pluginPath,
				await readFile(
					resolve(REPO_ROOT, "apps/examples/subagent-plugin/index.ts"),
					"utf8",
				),
				"utf8",
			);

			await expect(
				loadAgentPluginFromPath(pluginPath, { cwd: dir }),
			).rejects.toThrow(/Cannot find (package|module) 'yaml'/i);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("rejects invalid plugin export missing manifest", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-loader-"));
		try {
			const pluginPath = join(dir, "invalid-plugin.mjs");
			await writeFile(
				pluginPath,
				"export default { name: 'invalid-plugin' };",
				"utf8",
			);

			await expect(loadAgentPluginFromPath(pluginPath)).rejects.toThrow(
				/missing required "manifest"/i,
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
