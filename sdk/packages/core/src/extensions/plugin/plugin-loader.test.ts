import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	loadAgentPluginFromPath,
	loadAgentPluginsFromPaths,
} from "./plugin-loader";

describe("plugin-loader", () => {
	let dir = "";
	let copyDir = "";

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "core-plugin-loader-"));
		copyDir = await mkdtemp(join(tmpdir(), "core-plugin-loader-copy-"));

		await writeFile(
			join(dir, "plugin-default.mjs"),
			[
				"export default {",
				"  name: 'from-default',",
				"  manifest: { capabilities: ['hooks'], hookStages: ['input'] },",
				"  onInput: ({ input }) => ({ overrideInput: input })",
				"};",
			].join("\n"),
			"utf8",
		);
		await writeFile(
			join(dir, "plugin-named.mjs"),
			[
				"export const plugin = {",
				"  name: 'from-named',",
				"  manifest: { capabilities: ['tools'] },",
				"};",
			].join("\n"),
			"utf8",
		);
		await writeFile(
			join(dir, "plugin-a.mjs"),
			"export default { name: 'plugin-a', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);
		await writeFile(
			join(dir, "plugin-b.mjs"),
			"export default { name: 'plugin-b', manifest: { capabilities: ['commands'] } };",
			"utf8",
		);
		await writeFile(
			join(dir, "plugin-ts.ts"),
			[
				"const name: string = 'plugin-ts';",
				"export default {",
				"  name,",
				"  manifest: { capabilities: ['tools'] },",
				"};",
			].join("\n"),
			"utf8",
		);

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
		await writeFile(
			join(dir, "plugin-with-dep.ts"),
			[
				"import { depName } from 'plugin-local-dep';",
				"export default {",
				"  name: depName,",
				"  manifest: { capabilities: ['tools'] },",
				"};",
			].join("\n"),
			"utf8",
		);

		const sdkDir = join(dir, "node_modules", "@clinebot", "shared");
		await mkdir(sdkDir, { recursive: true });
		await writeFile(
			join(sdkDir, "package.json"),
			JSON.stringify({
				name: "@clinebot/shared",
				type: "module",
				exports: "./index.js",
			}),
			"utf8",
		);
		await writeFile(
			join(sdkDir, "index.js"),
			"export const sdkMarker = 'plugin-installed-sdk';\n",
			"utf8",
		);
		await writeFile(
			join(dir, "plugin-with-sdk-dep.ts"),
			[
				"import { sdkMarker } from '@clinebot/shared';",
				"export default {",
				"  name: sdkMarker,",
				"  manifest: { capabilities: ['tools'] },",
				"};",
			].join("\n"),
			"utf8",
		);

		await writeFile(
			join(copyDir, "portable-subagents.ts"),
			[
				"import { resolveClineDataDir } from '@clinebot/shared/storage';",
				"import YAML from 'yaml';",
				"export default {",
				"  name: typeof resolveClineDataDir === 'function' ? YAML.stringify({ ok: true }) : 'invalid',",
				"  manifest: { capabilities: ['tools'] },",
				"};",
			].join("\n"),
			"utf8",
		);

		await writeFile(
			join(dir, "invalid-plugin.mjs"),
			"export default { name: 'invalid-plugin' };",
			"utf8",
		);
	});

	afterAll(async () => {
		if (dir) {
			await rm(dir, { recursive: true, force: true });
		}
		if (copyDir) {
			await rm(copyDir, { recursive: true, force: true });
		}
	});

	it("loads default-exported plugin from path", async () => {
		const plugin = await loadAgentPluginFromPath(
			join(dir, "plugin-default.mjs"),
		);
		expect(plugin.name).toBe("from-default");
		expect(plugin.manifest.capabilities).toContain("hooks");
	});

	it("loads named plugin export from path", async () => {
		const plugin = await loadAgentPluginFromPath(
			join(dir, "plugin-named.mjs"),
			{
				exportName: "plugin",
			},
		);
		expect(plugin.name).toBe("from-named");
	});

	it("loads multiple plugins from file paths", async () => {
		const plugins = await loadAgentPluginsFromPaths([
			join(dir, "plugin-a.mjs"),
			join(dir, "plugin-b.mjs"),
		]);
		expect(plugins.map((plugin) => plugin.name)).toEqual([
			"plugin-a",
			"plugin-b",
		]);
	});

	it("loads TypeScript plugins from file paths", async () => {
		const plugin = await loadAgentPluginFromPath(join(dir, "plugin-ts.ts"));
		expect(plugin.name).toBe("plugin-ts");
	});

	it("resolves plugin-local dependencies from the plugin path", async () => {
		const plugin = await loadAgentPluginFromPath(
			join(dir, "plugin-with-dep.ts"),
			{ cwd: dir },
		);
		expect(plugin.name).toBe("plugin-local-dep");
	});

	it("prefers plugin-installed SDK packages over workspace aliases", async () => {
		const plugin = await loadAgentPluginFromPath(
			join(dir, "plugin-with-sdk-dep.ts"),
			{ cwd: dir },
		);
		expect(plugin.name).toBe("plugin-installed-sdk");
	});

	it("requires copied plugins to provide their own non-SDK dependencies", async () => {
		await expect(
			loadAgentPluginFromPath(join(copyDir, "portable-subagents.ts"), {
				cwd: copyDir,
				useCache: true,
			}),
		).rejects.toThrow(/Cannot find (package|module) 'yaml'/i);
	});

	it("rejects invalid plugin export missing manifest", async () => {
		await expect(
			loadAgentPluginFromPath(join(dir, "invalid-plugin.mjs")),
		).rejects.toThrow(/missing required "manifest"/i);
	});
});
