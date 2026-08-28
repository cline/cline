import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	AGENT_CONFIG_DIRECTORY_NAME,
	CLINE_CHAT_WORKSPACE_DIRECTORY_NAME,
	CLINE_CONNECTOR_SETTINGS_FILE_NAME,
	CLINE_MCP_SETTINGS_FILE_NAME,
	CLINE_WORKSPACES_DIRECTORY_NAME,
	discoverPluginModulePaths,
	getPluginDisplayName,
	HOOKS_CONFIG_DIRECTORY_NAME,
	isAgentPluginDirectory,
	isChatWorkspacePath,
	RULES_CONFIG_DIRECTORY_NAME,
	resolveAgentsConfigDirPath,
	resolveChatWorkspacePath,
	resolveClineDataDir,
	resolveConfiguredPluginModulePaths,
	resolveConnectorDataDir,
	resolveConnectorSettingsPath,
	resolveDbDataDir,
	resolveGlobalAgentsRulesPath,
	resolveGlobalSettingsPath,
	resolveHooksConfigSearchPaths,
	resolveMcpSettingsPath,
	resolvePluginModuleEntries,
	resolveProviderSettingsPath,
	resolveRulesConfigSearchPaths,
	resolveSessionDataDir,
	resolveTeamDataDir,
	resolveWorkflowsConfigSearchPaths,
} from "./paths";

type EnvSnapshot = {
	CLINE_DIR: string | undefined;
	CLINE_DATA_DIR: string | undefined;
	CLINE_CONNECTOR_DATA_DIR: string | undefined;
	CLINE_CONNECTOR_SETTINGS_PATH: string | undefined;
	CLINE_DB_DATA_DIR: string | undefined;
	CLINE_GLOBAL_SETTINGS_PATH: string | undefined;
	CLINE_MCP_SETTINGS_PATH: string | undefined;
	CLINE_PROVIDER_SETTINGS_PATH: string | undefined;
	CLINE_SESSION_DATA_DIR: string | undefined;
	CLINE_TEAM_DATA_DIR: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
		CLINE_CONNECTOR_DATA_DIR: process.env.CLINE_CONNECTOR_DATA_DIR,
		CLINE_CONNECTOR_SETTINGS_PATH: process.env.CLINE_CONNECTOR_SETTINGS_PATH,
		CLINE_DB_DATA_DIR: process.env.CLINE_DB_DATA_DIR,
		CLINE_GLOBAL_SETTINGS_PATH: process.env.CLINE_GLOBAL_SETTINGS_PATH,
		CLINE_MCP_SETTINGS_PATH: process.env.CLINE_MCP_SETTINGS_PATH,
		CLINE_PROVIDER_SETTINGS_PATH: process.env.CLINE_PROVIDER_SETTINGS_PATH,
		CLINE_SESSION_DATA_DIR: process.env.CLINE_SESSION_DATA_DIR,
		CLINE_TEAM_DATA_DIR: process.env.CLINE_TEAM_DATA_DIR,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.CLINE_DATA_DIR = snapshot.CLINE_DATA_DIR;
	process.env.CLINE_CONNECTOR_DATA_DIR = snapshot.CLINE_CONNECTOR_DATA_DIR;
	process.env.CLINE_CONNECTOR_SETTINGS_PATH =
		snapshot.CLINE_CONNECTOR_SETTINGS_PATH;
	process.env.CLINE_DIR = snapshot.CLINE_DIR;
	process.env.CLINE_DB_DATA_DIR = snapshot.CLINE_DB_DATA_DIR;
	process.env.CLINE_GLOBAL_SETTINGS_PATH = snapshot.CLINE_GLOBAL_SETTINGS_PATH;
	process.env.CLINE_MCP_SETTINGS_PATH = snapshot.CLINE_MCP_SETTINGS_PATH;
	process.env.CLINE_PROVIDER_SETTINGS_PATH =
		snapshot.CLINE_PROVIDER_SETTINGS_PATH;
	process.env.CLINE_SESSION_DATA_DIR = snapshot.CLINE_SESSION_DATA_DIR;
	process.env.CLINE_TEAM_DATA_DIR = snapshot.CLINE_TEAM_DATA_DIR;
}

describe("storage path resolution", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
	});

	it("uses CLINE_DATA_DIR as-is when set", () => {
		snapshot = captureEnv();
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveClineDataDir()).toBe("/tmp/cline-data");
	});

	it("falls back to CLINE_DATA_DIR/sessions for session storage", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_SESSION_DATA_DIR;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveSessionDataDir()).toBe(join("/tmp/cline-data", "sessions"));
	});

	it("falls back to CLINE_DATA_DIR/teams for team storage", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_TEAM_DATA_DIR;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveTeamDataDir()).toBe(join("/tmp/cline-data", "teams"));
	});

	it("falls back to CLINE_DATA_DIR/connectors for connector storage", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_CONNECTOR_DATA_DIR;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveConnectorDataDir()).toBe(
			join("/tmp/cline-data", "connectors"),
		);
	});

	it("falls back to CLINE_DATA_DIR/connectors/settings.json for connector settings", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_CONNECTOR_DATA_DIR;
		delete process.env.CLINE_CONNECTOR_SETTINGS_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveConnectorSettingsPath()).toBe(
			join("/tmp/cline-data", "connectors", CLINE_CONNECTOR_SETTINGS_FILE_NAME),
		);
	});

	it("uses CLINE_CONNECTOR_SETTINGS_PATH as-is when set", () => {
		snapshot = captureEnv();
		process.env.CLINE_CONNECTOR_SETTINGS_PATH =
			"/tmp/cline-connectors/custom-settings.json";

		expect(resolveConnectorSettingsPath()).toBe(
			"/tmp/cline-connectors/custom-settings.json",
		);
	});

	it("falls back to CLINE_DATA_DIR/db for sqlite storage", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_DB_DATA_DIR;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveDbDataDir()).toBe(join("/tmp/cline-data", "db"));
	});

	it("falls back to CLINE_DATA_DIR/settings/providers.json for provider settings", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_PROVIDER_SETTINGS_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveProviderSettingsPath()).toBe(
			join("/tmp/cline-data", "settings", "providers.json"),
		);
	});

	it("falls back to CLINE_DATA_DIR/settings/global-settings.json for global settings", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_GLOBAL_SETTINGS_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveGlobalSettingsPath()).toBe(
			join("/tmp/cline-data", "settings", "global-settings.json"),
		);
	});

	it("falls back to CLINE_DATA_DIR/settings/cline_mcp_settings.json for MCP settings", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_MCP_SETTINGS_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveMcpSettingsPath()).toBe(
			join("/tmp/cline-data", "settings", CLINE_MCP_SETTINGS_FILE_NAME),
		);
	});

	it("falls back to ~/.cline/.agents for agent configs", () => {
		snapshot = captureEnv();
		process.env.CLINE_DIR = "/tmp/home/.cline";

		expect(resolveAgentsConfigDirPath()).toBe(
			join("/tmp/home", ".cline", AGENT_CONFIG_DIRECTORY_NAME),
		);
	});

	it("resolves global hooks from ~/.cline", () => {
		snapshot = captureEnv();
		process.env.CLINE_DIR = "/tmp/home/.cline";
		process.env.CLINE_DATA_DIR = "/tmp/home/.cline/data";

		expect(resolveHooksConfigSearchPaths()).toEqual(
			expect.arrayContaining([
				join("/tmp/home", ".cline", HOOKS_CONFIG_DIRECTORY_NAME),
			]),
		);
		expect(resolveHooksConfigSearchPaths()).not.toContain(
			join("/tmp/home", ".cline", "data", HOOKS_CONFIG_DIRECTORY_NAME),
		);
	});

	it("resolves global rules from ~/.cline", () => {
		snapshot = captureEnv();
		process.env.CLINE_DIR = "/tmp/home/.cline";
		process.env.CLINE_DATA_DIR = "/tmp/home/.cline/data";

		expect(resolveRulesConfigSearchPaths()).toEqual(
			expect.arrayContaining([
				resolveGlobalAgentsRulesPath(),
				join("/tmp/home", ".cline", RULES_CONFIG_DIRECTORY_NAME),
				// xdg-user-dir's unconfigured Documents fallback (cline/cline#13542)
				join(
					dirname(dirname(resolveGlobalAgentsRulesPath())),
					"Cline",
					"Rules",
				),
			]),
		);
		expect(resolveRulesConfigSearchPaths()).not.toContain(
			join("/tmp/home", ".cline", "data", RULES_CONFIG_DIRECTORY_NAME),
		);
	});

	it("resolves legacy and new workflow paths, with .cline paths later for duplicate-name precedence", () => {
		snapshot = captureEnv();
		process.env.CLINE_DIR = "/tmp/home/.cline";
		const workspacePath = "/repo/demo";

		const paths = resolveWorkflowsConfigSearchPaths(workspacePath);

		expect(paths).toEqual([
			join(workspacePath, ".clinerules", "workflows"),
			expect.stringContaining(join("Documents", "Cline", "Workflows")),
			join("/tmp/home", ".cline", "workflows"),
			join(workspacePath, ".cline", "workflows"),
		]);
	});
});

describe("chat workspace paths", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
	});

	it("exports the canonical path segments", () => {
		expect(CLINE_WORKSPACES_DIRECTORY_NAME).toBe("workspaces");
		expect(CLINE_CHAT_WORKSPACE_DIRECTORY_NAME).toBe("chat");
	});

	it("resolves the shared chat workspace under the cline data dir", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_DATA_DIR;
		process.env.CLINE_DIR = "/tmp/home/.cline";

		expect(resolveChatWorkspacePath()).toBe(
			join("/tmp/home/.cline", "data", "workspaces", "chat"),
		);
	});

	it("honors the CLINE_DATA_DIR override", () => {
		snapshot = captureEnv();
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveChatWorkspacePath()).toBe(
			join("/tmp/cline-data", "workspaces", "chat"),
		);
	});

	it.each([
		"/home/user/.cline/data/workspaces/chat",
		"//home//user//.cline//data//workspaces//chat//",
		"C:\\Users\\dev\\.cline\\data\\workspaces\\chat\\",
		"\\\\server\\share\\.cline\\data\\workspaces\\chat",
	])("recognizes chat workspace root %s", (path) => {
		expect(isChatWorkspacePath(path)).toBe(true);
	});

	it.each([
		".cline/data/workspaces/chat",
		"/tmp/chat",
		"/tmp/cline/sessions/session-a1b2c3-temp/project",
		"/home/user/cline/data/workspaces/chat",
		"/home/user/.cline/workspaces/chat",
		"/home/user/.cline/data/other/chat",
		"/home/user/.cline/data/workspaces/Chat",
		"/home/user/.cline/data/workspaces/chat/my-app",
		"/home/user/.cline/data/workspaces",
	])("rejects non-chat workspace path %s", (path) => {
		expect(isChatWorkspacePath(path)).toBe(false);
	});
});

describe("getPluginDisplayName", () => {
	const tempRoots: string[] = [];

	function createTempRoot(): string {
		const root = mkdtempSync(join(tmpdir(), "cline-plugin-name-"));
		tempRoots.push(root);
		return root;
	}

	afterEach(() => {
		for (const root of tempRoots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("uses the package name for package-backed installed plugin entries", () => {
		const root = createTempRoot();
		const packageDir = join(
			root,
			"_installed",
			"local",
			"agents-squad-057fda0dd505",
			"package",
		);
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({ name: "cline-agents-squad-plugin" }),
		);
		const entryPath = join(packageDir, "index.ts");
		writeFileSync(entryPath, "export default {};");

		expect(getPluginDisplayName(entryPath, root)).toBe(
			"cline-agents-squad-plugin",
		);
	});

	it("finds the package name in an ancestor directory within the search root", () => {
		const root = createTempRoot();
		const packageDir = join(root, "my-plugin");
		const srcDir = join(packageDir, "src");
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({ name: "my-plugin" }),
		);
		const entryPath = join(srcDir, "index.ts");
		writeFileSync(entryPath, "export default {};");

		expect(getPluginDisplayName(entryPath, root)).toBe("my-plugin");
	});

	it("falls back to the file basename when package.json has no usable name", () => {
		const root = createTempRoot();
		const packageDir = join(root, "unnamed", "package");
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(join(packageDir, "package.json"), JSON.stringify({}));
		const entryPath = join(packageDir, "index.ts");
		writeFileSync(entryPath, "export default {};");

		expect(getPluginDisplayName(entryPath, root)).toBe("index");
	});

	it("falls back to the file basename for bare plugin modules", () => {
		const root = createTempRoot();
		const entryPath = join(root, "x-poster.js");
		writeFileSync(entryPath, "module.exports = {};");

		expect(getPluginDisplayName(entryPath, root)).toBe("x-poster");
	});

	it("does not read package.json files above the search root", () => {
		const outer = createTempRoot();
		writeFileSync(
			join(outer, "package.json"),
			JSON.stringify({ name: "outer-package" }),
		);
		const root = join(outer, "plugins");
		mkdirSync(root, { recursive: true });
		const entryPath = join(root, "index.ts");
		writeFileSync(entryPath, "export default {};");

		expect(getPluginDisplayName(entryPath, root)).toBe("index");
	});
});

describe("Cline plugin discovery boundary", () => {
	const tempRoots: string[] = [];

	function createTempRoot(): string {
		const root = mkdtempSync(join(tmpdir(), "cline-plugin-boundary-"));
		tempRoots.push(root);
		return root;
	}

	function writeFile(path: string, contents: string): string {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, contents);
		return path;
	}

	/**
	 * A minimal conformant Agent Plugin: a skill with an executable script, a
	 * second vendor's extension directory, and a vendored dependency. None of it
	 * is a Cline plugin module.
	 */
	function writeAgentPlugin(pluginRoot: string): void {
		writeFile(
			join(pluginRoot, "plugin.json"),
			JSON.stringify({
				$schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
				name: "summarizer",
			}),
		);
		writeFile(
			join(pluginRoot, "mcp.json"),
			JSON.stringify({
				$schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
				mcpServers: {},
			}),
		);
		writeFile(
			join(pluginRoot, "skills", "summarize", "SKILL.md"),
			"---\nname: summarize\n---\n",
		);
		writeFile(
			join(pluginRoot, "skills", "summarize", "scripts", "fetch.js"),
			"throw new Error('skill script must never be imported');",
		);
		writeFile(
			join(pluginRoot, "skills", "summarize", "scripts", "build.ts"),
			"export const helper = 1;",
		);
		writeFile(
			join(pluginRoot, "com.example.client", "setup.js"),
			"throw new Error('another vendor namespace must never be imported');",
		);
		writeFile(
			join(pluginRoot, "node_modules", "left-pad", "package.json"),
			JSON.stringify({ name: "left-pad", main: "index.js" }),
		);
		writeFile(
			join(pluginRoot, "node_modules", "left-pad", "index.js"),
			"module.exports = () => {};",
		);
	}

	afterEach(() => {
		for (const root of tempRoots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("claims nothing from an Agent Plugin dropped into a Cline plugin root", () => {
		const root = createTempRoot();
		writeAgentPlugin(join(root, "summarizer"));

		expect(discoverPluginModulePaths(root)).toEqual([]);
	});

	it("claims nothing when the scan root is itself an Agent Plugin", () => {
		const root = createTempRoot();
		writeAgentPlugin(root);

		expect(discoverPluginModulePaths(root)).toEqual([]);
	});

	it("never descends into node_modules", () => {
		const root = createTempRoot();
		const entryPath = writeFile(
			join(root, "my-plugin", "index.ts"),
			"export default {};",
		);
		writeFile(
			join(root, "my-plugin", "node_modules", "dep", "index.js"),
			"module.exports = {};",
		);

		expect(discoverPluginModulePaths(root)).toEqual([entryPath]);
	});

	it("never descends into dot directories", () => {
		const root = createTempRoot();
		const entryPath = writeFile(join(root, "plugin.ts"), "export default {};");
		writeFile(
			join(root, ".git", "hooks", "pre-commit.js"),
			"module.exports={};",
		);

		expect(discoverPluginModulePaths(root)).toEqual([entryPath]);
	});

	it("still discovers bare Cline plugin modules", () => {
		const root = createTempRoot();
		const first = writeFile(join(root, "alpha.ts"), "export default {};");
		const second = writeFile(
			join(root, "nested", "beta.js"),
			"export default {};",
		);

		expect(discoverPluginModulePaths(root)).toEqual([first, second]);
	});

	it("still honors package.json-declared Cline plugin entries", () => {
		const root = createTempRoot();
		const packageDir = join(root, "declared");
		writeFile(
			join(packageDir, "package.json"),
			JSON.stringify({ cline: { plugins: [{ paths: ["entry.ts"] }] } }),
		);
		const entryPath = writeFile(
			join(packageDir, "entry.ts"),
			"export default {};",
		);
		writeFile(join(packageDir, "helper.ts"), "export const helper = 1;");

		expect(discoverPluginModulePaths(root)).toEqual([entryPath]);
	});

	it("resolves no module entries for an Agent Plugin directory", () => {
		const root = createTempRoot();
		writeAgentPlugin(root);
		// An index.ts at the root would otherwise be claimed as the Cline plugin
		// entry point, so this asserts the manifest wins over the index fallback.
		writeFile(join(root, "index.ts"), "export default {};");

		expect(resolvePluginModuleEntries(root)).toBeNull();
	});

	it("resolves no modules for an explicitly configured Agent Plugin path", () => {
		const root = createTempRoot();
		writeAgentPlugin(join(root, "summarizer"));

		expect(resolveConfiguredPluginModulePaths(["summarizer"], root)).toEqual(
			[],
		);
	});

	it("detects an Agent Plugin manifest only when it is a regular file", () => {
		const root = createTempRoot();
		expect(isAgentPluginDirectory(root)).toBe(false);

		mkdirSync(join(root, "plugin.json"), { recursive: true });
		expect(isAgentPluginDirectory(root)).toBe(false);

		rmSync(join(root, "plugin.json"), { recursive: true, force: true });
		writeFileSync(join(root, "plugin.json"), "{}");
		expect(isAgentPluginDirectory(root)).toBe(true);
	});
});
