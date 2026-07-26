import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	discoverPluginModulePaths,
	setClineDir,
	setHomeDir,
} from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installPlugin, parsePluginSource } from "./plugin-install";

describe("local-only plugin install service", () => {
	let root = "";
	let home = "";
	let workspace = "";
	let originalHome: string | undefined;
	let originalClineDir: string | undefined;
	let originalClineDataDir: string | undefined;
	let originalMcpSettingsPath: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "core-local-plugin-install-"));
		home = join(root, "home");
		workspace = join(root, "workspace");
		originalHome = process.env.HOME;
		originalClineDir = process.env.CLINE_DIR;
		originalClineDataDir = process.env.CLINE_DATA_DIR;
		originalMcpSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		process.env.HOME = home;
		process.env.CLINE_DIR = join(home, ".cline");
		process.env.CLINE_DATA_DIR = join(home, ".cline", "data");
		process.env.CLINE_MCP_SETTINGS_PATH = join(
			home,
			".cline",
			"cline_mcp_settings.json",
		);
		setHomeDir(home);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		if (originalClineDir === undefined) delete process.env.CLINE_DIR;
		else process.env.CLINE_DIR = originalClineDir;
		if (originalClineDataDir === undefined) delete process.env.CLINE_DATA_DIR;
		else process.env.CLINE_DATA_DIR = originalClineDataDir;
		if (originalMcpSettingsPath === undefined) {
			delete process.env.CLINE_MCP_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_SETTINGS_PATH = originalMcpSettingsPath;
		}
		rmSync(root, { recursive: true, force: true });
	});

	it("accepts explicit local paths and rejects npm, Git, and remote sources", async () => {
		const source = join(root, "weather.ts");
		writeFileSync(
			source,
			"export default { name: 'weather', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);

		expect(parsePluginSource(source)).toEqual({ type: "local", path: source });
		for (const rejected of [
			"npm:@acme/weather",
			"git:https://github.com/acme/weather.git",
			"https://example.com/weather.ts",
			"github.com/acme/weather",
		]) {
			expect(() => parsePluginSource(rejected)).toThrow(
				/Remote, npm, and Git/,
			);
		}

		const result = await installPlugin({ source, cwd: workspace });
		expect(result.installPath).toContain(
			join(workspace, ".cline", "plugins", "_installed", "local"),
		);
		expect(result.entryPaths).toHaveLength(1);
		expect(existsSync(result.entryPaths[0] ?? "")).toBe(true);
		expect(
			discoverPluginModulePaths(join(workspace, ".cline", "plugins")),
		).toEqual(result.entryPaths);
	});
});
