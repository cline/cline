import { describe, expect, test } from "bun:test";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	installPlugin,
	loadAgentPluginFromPath,
	resolveAndLoadAgentPlugins,
} from "@cline/core";
import { setClineDir } from "@cline/shared/storage";
import {
	buildPlugin,
	collectStaticModuleSpecifiers,
	forbiddenBareSpecifiers,
	PLUGIN_DIST_DIR,
	PLUGIN_DIST_ENTRY,
	PLUGIN_ROOT,
} from "../scripts/build";
import { useTempDirs } from "./test-support";

const tempDir = useTempDirs("next-turn-dist-", { restoreClineDir: true });

describe("dist/index.js bundle", () => {
	test("bundles into a single entry with only host-aliased bare specifiers, and refuses unknown ones", async () => {
		const outDir = join(tempDir(), PLUGIN_DIST_DIR);
		const { entryPath, bytes } = await buildPlugin({ outDir });
		expect(bytes).toBeGreaterThan(1_000);
		const source = readFileSync(entryPath, "utf8");
		expect(forbiddenBareSpecifiers(source)).toEqual([]);
		expect(source).not.toContain("NextTurnLabelRecord");
		const specifiers = collectStaticModuleSpecifiers(source);
		expect(specifiers).toEqual(
			expect.arrayContaining(["@cline/core", "@cline/core/hub", "@cline/llms"]),
		);
		expect(
			forbiddenBareSpecifiers(
				'import { someHelper } from "unknown-pkg";\nconst x = require("left-pad");',
			),
		).toEqual(["unknown-pkg", "left-pad"]);
	});

	test("installs into a clean CLINE_DIR with no node_modules and loads in the real sandbox within budget", async () => {
		const stage = join(tempDir(), "stage");
		const clineDir = join(tempDir(), "cline");
		const outDir = join(stage, PLUGIN_DIST_DIR);
		await buildPlugin({ outDir });
		const pkg = JSON.parse(
			readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8"),
		) as Record<string, unknown> & {
			cline: { plugins: Record<string, unknown>[] };
		};
		expect(pkg.type).toBeUndefined();
		writeFileSync(
			join(stage, "package.json"),
			JSON.stringify(
				{
					name: pkg.name,
					version: pkg.version,
					private: true,
					cline: {
						plugins: pkg.cline.plugins.map((entry) => ({
							...entry,
							paths: [`./${PLUGIN_DIST_DIR}/${PLUGIN_DIST_ENTRY}`],
						})),
					},
					peerDependencies: pkg.peerDependencies,
					peerDependenciesMeta: pkg.peerDependenciesMeta,
				},
				null,
				2,
			),
		);
		setClineDir(clineDir);
		const installed = await installPlugin({
			source: stage,
			force: true,
			npmCommand: "true",
		});
		expect(installed.entryPaths).toHaveLength(1);
		const entry = installed.entryPaths[0] ?? "";
		expect(
			entry.endsWith(`/package/${PLUGIN_DIST_DIR}/${PLUGIN_DIST_ENTRY}`),
		).toBe(true);

		const loaded = await loadAgentPluginFromPath(entry, { useCache: false });
		expect(loaded.name).toBe("next-turn");

		const start = performance.now();
		const sandboxed = await resolveAndLoadAgentPlugins({
			pluginPaths: [entry],
			session: { sessionId: "dist_sess" },
			client: { name: "cline-desktop" },
			workspaceInfo: { rootPath: stage },
		});
		const elapsedMs = performance.now() - start;
		try {
			expect(sandboxed.failures).toEqual([]);
			expect(sandboxed.extensions.map((plugin) => plugin.name)).toEqual([
				"next-turn",
			]);
			expect(elapsedMs).toBeLessThanOrEqual(2_000);
		} finally {
			await sandboxed.shutdown?.();
		}

		const probeDir = join(tempDir(), "probe");
		cpSync(stage, probeDir, { recursive: true });
		writeFileSync(
			join(probeDir, PLUGIN_DIST_DIR, PLUGIN_DIST_ENTRY),
			[
				'import * as core from "@cline/core";',
				'import * as hub from "@cline/core/hub";',
				'import * as llms from "@cline/llms";',
				'import * as storage from "@cline/shared/storage";',
				"export default {",
				'  name: "probe",',
				'  manifest: { capabilities: ["hooks"] },',
				"  setup() {",
				"    if (typeof core.ProviderSettingsManager !== 'function') throw new Error('missing @cline/core');",
				"    if (typeof hub.NodeHubClient !== 'function') throw new Error('missing @cline/core/hub');",
				"    if (typeof llms.createHandlerAsync !== 'function') throw new Error('missing @cline/llms');",
				"    if (typeof storage.resolveWorkspaceTaskSpecsDir !== 'function') throw new Error('missing @cline/shared/storage');",
				"  },",
				"};",
			].join("\n"),
		);
		const probeInstall = await installPlugin({
			source: probeDir,
			force: true,
			npmCommand: "true",
		});
		const probeSandbox = await resolveAndLoadAgentPlugins({
			pluginPaths: probeInstall.entryPaths,
			session: { sessionId: "probe_sess" },
		});
		try {
			expect(probeSandbox.failures).toEqual([]);
			expect(probeSandbox.extensions.map((plugin) => plugin.name)).toEqual([
				"probe",
				"next-turn",
			]);
		} finally {
			await probeSandbox.shutdown?.();
		}
	});
});
