import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	PluginRegistry,
	resetProcessPluginRegistryForTests,
} from "../extensions/plugin/plugin-registry";
import { listPluginToolsWithDiagnostics } from "./plugin-tools";

describe("listPluginToolsWithDiagnostics", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_GLOBAL_SETTINGS_PATH: process.env.CLINE_GLOBAL_SETTINGS_PATH,
		CLINE_PLUGIN_MODE: process.env.CLINE_PLUGIN_MODE,
	};
	let root: string;
	let registry: PluginRegistry;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "core-plugin-tools-"));
		process.env.HOME = root;
		setHomeDir(root);
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(root, "settings.json");
		registry = new PluginRegistry();
		resetProcessPluginRegistryForTests(registry);
		await mkdir(join(root, ".cline", "plugins"), { recursive: true });
	});

	afterEach(async () => {
		resetProcessPluginRegistryForTests(undefined);
		for (const [key, value] of Object.entries(envSnapshot)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		setHomeDir(envSnapshot.HOME ?? "~");
		await rm(root, { recursive: true, force: true });
	});

	const writePlugin = async (name: string) => {
		const path = join(root, ".cline", "plugins", `${name}.js`);
		await writeFile(
			path,
			`export default {
	name: "${name}",
	manifest: { capabilities: ["tools"] },
	setup(api) { api.registerTool({ name: "${name}_tool", description: "", inputSchema: {}, execute: () => "ok" }); },
};`,
			"utf8",
		);
		return path;
	};

	it("does not answer from a cached inspection after the plugin is turned off", async () => {
		const path = await writePlugin("cached");
		const first = await listPluginToolsWithDiagnostics({ workspacePath: root });
		expect(first.tools.map((tool) => tool.name)).toEqual(["cached_tool"]);

		// A running session's copy failed badly enough to turn it off.
		const error = new Error("stray");
		error.stack = `Error: stray\n    at run (${path}:1:1)`;
		registry.attributeUncaughtError(error);

		const second = await listPluginToolsWithDiagnostics({
			workspacePath: root,
		});
		expect(second.tools).toEqual([]);
		expect(second.plugins).toEqual([
			expect.objectContaining({ pluginName: "cached", state: "failed" }),
		]);
	});

	it("inspects plugins through the sandbox in sandbox mode", async () => {
		await writePlugin("sandboxed");
		process.env.CLINE_PLUGIN_MODE = "sandbox";

		const result = await listPluginToolsWithDiagnostics({
			workspacePath: root,
		});

		expect(result.tools.map((tool) => tool.name)).toEqual(["sandboxed_tool"]);
		// Nothing was imported into this process.
		expect(registry.list()).toEqual([]);
	});
});
