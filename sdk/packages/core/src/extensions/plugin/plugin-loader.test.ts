import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	loadAgentPluginFromPath,
	loadAgentPluginsFromPaths,
	loadAgentPluginsFromPathsWithDiagnostics,
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
				"  manifest: { capabilities: ['hooks'] },",
				"  hooks: { beforeRun: () => undefined }",
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

		const sdkDir = join(dir, "node_modules", "@cline", "shared");
		await mkdir(sdkDir, { recursive: true });
		await writeFile(
			join(sdkDir, "package.json"),
			JSON.stringify({
				name: "@cline/shared",
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
				"import { sdkMarker } from '@cline/shared';",
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
				"import { safeJsonStringify } from '@cline/shared';",
				"import { resolveClineDataDir } from '@cline/shared/storage';",
				"import YAML from 'yaml';",
				"export default {",
				"  name: typeof safeJsonStringify === 'function' ? YAML.stringify({ ok: !!resolveClineDataDir() }) : 'invalid',",
				"  manifest: { capabilities: ['tools'] },",
				"};",
			].join("\n"),
			"utf8",
		);

		const packagedCopyDir = join(copyDir, "packaged-plugin");
		await mkdir(packagedCopyDir, { recursive: true });
		await writeFile(
			join(packagedCopyDir, "package.json"),
			JSON.stringify({
				name: "packaged-plugin",
				type: "module",
				cline: {
					plugins: ["index.ts"],
				},
			}),
			"utf8",
		);
		await writeFile(
			join(packagedCopyDir, "index.ts"),
			[
				"import YAML from 'yaml';",
				"export default {",
				"  name: YAML.stringify({ ok: true }),",
				"  manifest: { capabilities: ['tools'] },",
				"};",
			].join("\n"),
			"utf8",
		);

		const packagedSdkSubpathDir = join(copyDir, "packaged-sdk-subpath");
		await mkdir(packagedSdkSubpathDir, { recursive: true });
		await writeFile(
			join(packagedSdkSubpathDir, "package.json"),
			JSON.stringify({
				name: "packaged-sdk-subpath",
				type: "module",
				cline: {
					plugins: ["index.ts"],
				},
			}),
			"utf8",
		);
		await writeFile(
			join(packagedSdkSubpathDir, "index.ts"),
			[
				"import { createConfiguredTelemetryHandle } from '@cline/core/telemetry';",
				"export default {",
				"  name: typeof createConfiguredTelemetryHandle === 'function' ? 'sdk-subpath-ok' : 'invalid',",
				"  manifest: { capabilities: ['tools'] },",
				"};",
			].join("\n"),
			"utf8",
		);

		const packagedTypeOnlyDir = join(copyDir, "packaged-type-only-imports");
		await mkdir(packagedTypeOnlyDir, { recursive: true });
		await writeFile(
			join(packagedTypeOnlyDir, "package.json"),
			JSON.stringify({
				name: "packaged-type-only-imports",
				type: "module",
				cline: {
					plugins: ["index.ts"],
				},
			}),
			"utf8",
		);
		await writeFile(
			join(packagedTypeOnlyDir, "index.ts"),
			[
				"import type { MissingStaticType } from 'missing-static-type';",
				"type MissingImportType = import('missing-import-type').Foo;",
				"type MissingTypeQuery = typeof import('missing-type-query');",
				"type TypeBag = { value: MissingStaticType; imported: MissingImportType; query: MissingTypeQuery };",
				"function acceptsTypeOnly(input: import('missing-param-type').Foo): TypeBag | undefined {",
				"  void input;",
				"  return undefined;",
				"}",
				"const value = {} as import('missing-assertion-type').Foo;",
				"void value;",
				"void acceptsTypeOnly;",
				"export default {",
				"  name: 'type-only-imports-ok',",
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

		await writeFile(
			join(dir, "duplicate-one.mjs"),
			"export default { name: 'duplicate-plugin', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);
		await writeFile(
			join(dir, "duplicate-two.mjs"),
			"export default { name: 'duplicate-plugin', manifest: { capabilities: ['commands'] } };",
			"utf8",
		);
		await writeFile(
			join(dir, "targeted-plugin.mjs"),
			[
				"export default {",
				"  name: 'targeted-plugin',",
				"  manifest: { capabilities: ['tools'], providerIds: ['openai'], modelIds: ['gpt-5.4'] },",
				"};",
			].join("\n"),
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

	it("allows standalone file plugins to use host runtime dependencies", async () => {
		const plugin = await loadAgentPluginFromPath(
			join(copyDir, "portable-subagents.ts"),
			{
				cwd: copyDir,
				useCache: true,
			},
		);
		expect(plugin.name).toMatch(/ok: true/i);
	});

	it("requires package-based plugins to provide their own non-SDK dependencies", async () => {
		await expect(
			loadAgentPluginFromPath(join(copyDir, "packaged-plugin", "index.ts"), {
				cwd: join(copyDir, "packaged-plugin"),
				useCache: true,
			}),
		).rejects.toThrow(/Cannot find (package|module) 'yaml'/i);
	});

	it("allows package-based plugins to use host SDK subpath exports", async () => {
		const plugin = await loadAgentPluginFromPath(
			join(copyDir, "packaged-sdk-subpath", "index.ts"),
			{
				cwd: join(copyDir, "packaged-sdk-subpath"),
				useCache: true,
			},
		);
		expect(plugin.name).toBe("sdk-subpath-ok");
	});

	it("allows package-based TypeScript plugins to reference type-only packages", async () => {
		const plugin = await loadAgentPluginFromPath(
			join(copyDir, "packaged-type-only-imports", "index.ts"),
			{
				cwd: join(copyDir, "packaged-type-only-imports"),
				useCache: true,
			},
		);
		expect(plugin.name).toBe("type-only-imports-ok");
	});

	it("rejects invalid plugin export missing manifest", async () => {
		await expect(
			loadAgentPluginFromPath(join(dir, "invalid-plugin.mjs")),
		).rejects.toThrow(/missing required "manifest"/i);
	});

	it("continues loading valid plugins when one plugin fails", async () => {
		const report = await loadAgentPluginsFromPathsWithDiagnostics([
			join(dir, "plugin-a.mjs"),
			join(dir, "invalid-plugin.mjs"),
			join(dir, "plugin-b.mjs"),
		]);

		expect(report.plugins.map((plugin) => plugin.name)).toEqual([
			"plugin-a",
			"plugin-b",
		]);
		expect(report.failures).toHaveLength(1);
		expect(report.failures[0]?.pluginPath).toBe(
			join(dir, "invalid-plugin.mjs"),
		);
		expect(report.warnings).toEqual([]);
	});

	it("keeps the later duplicate plugin and reports the override", async () => {
		const report = await loadAgentPluginsFromPathsWithDiagnostics([
			join(dir, "duplicate-one.mjs"),
			join(dir, "duplicate-two.mjs"),
		]);

		expect(report.plugins).toHaveLength(1);
		expect(report.plugins[0]?.name).toBe("duplicate-plugin");
		expect(report.plugins[0]?.manifest.capabilities).toEqual(["commands"]);
		expect(report.warnings).toHaveLength(1);
		expect(report.warnings[0]?.overriddenPluginPath).toBe(
			join(dir, "duplicate-one.mjs"),
		);
	});

	it("filters plugins by manifest providerIds and modelIds", async () => {
		const report = await loadAgentPluginsFromPathsWithDiagnostics(
			[join(dir, "plugin-a.mjs"), join(dir, "targeted-plugin.mjs")],
			{
				providerId: "openai",
				modelId: "gpt-5.4",
			},
		);
		expect(report.plugins.map((plugin) => plugin.name)).toEqual([
			"plugin-a",
			"targeted-plugin",
		]);

		const filtered = await loadAgentPluginsFromPathsWithDiagnostics(
			[join(dir, "plugin-a.mjs"), join(dir, "targeted-plugin.mjs")],
			{
				providerId: "anthropic",
				modelId: "claude-sonnet-4.5",
			},
		);
		expect(filtered.plugins.map((plugin) => plugin.name)).toEqual(["plugin-a"]);
	});
});
