import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	discoverPluginModulePaths,
	setBedrockCoderDir,
	setHomeDir,
} from "@bedrock-coder/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installPlugin, parsePluginSource } from "./plugin-install";

describe("local-only plugin install service", () => {
	let root = "";
	let home = "";
	let workspace = "";
	let originalHome: string | undefined;
	let originalBedrockCoderDir: string | undefined;
	let originalBedrockCoderDataDir: string | undefined;
	let originalMcpSettingsPath: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "core-local-plugin-install-"));
		home = join(root, "home");
		workspace = join(root, "workspace");
		originalHome = process.env.HOME;
		originalBedrockCoderDir = process.env.BEDROCK_CODER_DIR;
		originalBedrockCoderDataDir = process.env.BEDROCK_CODER_DATA_DIR;
		originalMcpSettingsPath = process.env.BEDROCK_CODER_MCP_SETTINGS_PATH;
		process.env.HOME = home;
		process.env.BEDROCK_CODER_DIR = join(home, ".bedrock-coder");
		process.env.BEDROCK_CODER_DATA_DIR = join(home, ".bedrock-coder", "data");
		process.env.BEDROCK_CODER_MCP_SETTINGS_PATH = join(
			home,
			".bedrock-coder",
			"mcp_settings.json",
		);
		setHomeDir(home);
		setBedrockCoderDir(process.env.BEDROCK_CODER_DIR);
	});

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		if (originalBedrockCoderDir === undefined) delete process.env.BEDROCK_CODER_DIR;
		else process.env.BEDROCK_CODER_DIR = originalBedrockCoderDir;
		if (originalBedrockCoderDataDir === undefined) delete process.env.BEDROCK_CODER_DATA_DIR;
		else process.env.BEDROCK_CODER_DATA_DIR = originalBedrockCoderDataDir;
		if (originalMcpSettingsPath === undefined) {
			delete process.env.BEDROCK_CODER_MCP_SETTINGS_PATH;
		} else {
			process.env.BEDROCK_CODER_MCP_SETTINGS_PATH = originalMcpSettingsPath;
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
			join(workspace, ".bedrock-coder", "plugins", "_installed", "local"),
		);
		expect(result.entryPaths).toHaveLength(1);
		expect(existsSync(result.entryPaths[0] ?? "")).toBe(true);
		expect(
			discoverPluginModulePaths(join(workspace, ".bedrock-coder", "plugins")),
		).toEqual(result.entryPaths);
	});
});
