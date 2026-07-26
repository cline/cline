import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	AGENT_CONFIG_DIRECTORY_NAME,
	BEDROCK_CODER_CHAT_WORKSPACE_DIRECTORY_NAME,
	BEDROCK_CODER_MCP_SETTINGS_FILE_NAME,
	BEDROCK_CODER_WORKSPACES_DIRECTORY_NAME,
	HOOKS_CONFIG_DIRECTORY_NAME,
	isChatWorkspacePath,
	RULES_CONFIG_DIRECTORY_NAME,
	resolveAgentsConfigDirPath,
	resolveChatWorkspacePath,
	resolveBedrockCoderDataDir,
	resolveDbDataDir,
	resolveGlobalAgentsRulesPath,
	resolveGlobalSettingsPath,
	resolveHooksConfigSearchPaths,
	resolveMcpSettingsPath,
	resolveProviderSettingsPath,
	resolveRulesConfigSearchPaths,
	resolveSessionDataDir,
	resolveTeamDataDir,
	resolveWorkflowsConfigSearchPaths,
} from "./paths";

type EnvSnapshot = {
	BEDROCK_CODER_DIR: string | undefined;
	BEDROCK_CODER_DATA_DIR: string | undefined;
	BEDROCK_CODER_DB_DATA_DIR: string | undefined;
	BEDROCK_CODER_GLOBAL_SETTINGS_PATH: string | undefined;
	BEDROCK_CODER_MCP_SETTINGS_PATH: string | undefined;
	BEDROCK_CODER_PROVIDER_SETTINGS_PATH: string | undefined;
	BEDROCK_CODER_SESSION_DATA_DIR: string | undefined;
	BEDROCK_CODER_TEAM_DATA_DIR: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		BEDROCK_CODER_DIR: process.env.BEDROCK_CODER_DIR,
		BEDROCK_CODER_DATA_DIR: process.env.BEDROCK_CODER_DATA_DIR,
		BEDROCK_CODER_DB_DATA_DIR: process.env.BEDROCK_CODER_DB_DATA_DIR,
		BEDROCK_CODER_GLOBAL_SETTINGS_PATH: process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH,
		BEDROCK_CODER_MCP_SETTINGS_PATH: process.env.BEDROCK_CODER_MCP_SETTINGS_PATH,
		BEDROCK_CODER_PROVIDER_SETTINGS_PATH: process.env.BEDROCK_CODER_PROVIDER_SETTINGS_PATH,
		BEDROCK_CODER_SESSION_DATA_DIR: process.env.BEDROCK_CODER_SESSION_DATA_DIR,
		BEDROCK_CODER_TEAM_DATA_DIR: process.env.BEDROCK_CODER_TEAM_DATA_DIR,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.BEDROCK_CODER_DATA_DIR = snapshot.BEDROCK_CODER_DATA_DIR;
	process.env.BEDROCK_CODER_DIR = snapshot.BEDROCK_CODER_DIR;
	process.env.BEDROCK_CODER_DB_DATA_DIR = snapshot.BEDROCK_CODER_DB_DATA_DIR;
	process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH = snapshot.BEDROCK_CODER_GLOBAL_SETTINGS_PATH;
	process.env.BEDROCK_CODER_MCP_SETTINGS_PATH = snapshot.BEDROCK_CODER_MCP_SETTINGS_PATH;
	process.env.BEDROCK_CODER_PROVIDER_SETTINGS_PATH =
		snapshot.BEDROCK_CODER_PROVIDER_SETTINGS_PATH;
	process.env.BEDROCK_CODER_SESSION_DATA_DIR = snapshot.BEDROCK_CODER_SESSION_DATA_DIR;
	process.env.BEDROCK_CODER_TEAM_DATA_DIR = snapshot.BEDROCK_CODER_TEAM_DATA_DIR;
}

describe("storage path resolution", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
	});

	it("uses BEDROCK_CODER_DATA_DIR as-is when set", () => {
		snapshot = captureEnv();
		process.env.BEDROCK_CODER_DATA_DIR = "/tmp/bedrock-coder-data";

		expect(resolveBedrockCoderDataDir()).toBe("/tmp/bedrock-coder-data");
	});

	it("falls back to BEDROCK_CODER_DATA_DIR/sessions for session storage", () => {
		snapshot = captureEnv();
		delete process.env.BEDROCK_CODER_SESSION_DATA_DIR;
		process.env.BEDROCK_CODER_DATA_DIR = "/tmp/bedrock-coder-data";

		expect(resolveSessionDataDir()).toBe(join("/tmp/bedrock-coder-data", "sessions"));
	});

	it("falls back to BEDROCK_CODER_DATA_DIR/teams for team storage", () => {
		snapshot = captureEnv();
		delete process.env.BEDROCK_CODER_TEAM_DATA_DIR;
		process.env.BEDROCK_CODER_DATA_DIR = "/tmp/bedrock-coder-data";

		expect(resolveTeamDataDir()).toBe(join("/tmp/bedrock-coder-data", "teams"));
	});

	it("falls back to BEDROCK_CODER_DATA_DIR/db for sqlite storage", () => {
		snapshot = captureEnv();
		delete process.env.BEDROCK_CODER_DB_DATA_DIR;
		process.env.BEDROCK_CODER_DATA_DIR = "/tmp/bedrock-coder-data";

		expect(resolveDbDataDir()).toBe(join("/tmp/bedrock-coder-data", "db"));
	});

	it("falls back to BEDROCK_CODER_DATA_DIR/settings/providers.json for provider settings", () => {
		snapshot = captureEnv();
		delete process.env.BEDROCK_CODER_PROVIDER_SETTINGS_PATH;
		process.env.BEDROCK_CODER_DATA_DIR = "/tmp/bedrock-coder-data";

		expect(resolveProviderSettingsPath()).toBe(
			join("/tmp/bedrock-coder-data", "settings", "providers.json"),
		);
	});

	it("falls back to BEDROCK_CODER_DATA_DIR/settings/global-settings.json for global settings", () => {
		snapshot = captureEnv();
		delete process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH;
		process.env.BEDROCK_CODER_DATA_DIR = "/tmp/bedrock-coder-data";

		expect(resolveGlobalSettingsPath()).toBe(
			join("/tmp/bedrock-coder-data", "settings", "global-settings.json"),
		);
	});

	it("falls back to BEDROCK_CODER_DATA_DIR/settings/mcp_settings.json for MCP settings", () => {
		snapshot = captureEnv();
		delete process.env.BEDROCK_CODER_MCP_SETTINGS_PATH;
		process.env.BEDROCK_CODER_DATA_DIR = "/tmp/bedrock-coder-data";

		expect(resolveMcpSettingsPath()).toBe(
			join("/tmp/bedrock-coder-data", "settings", BEDROCK_CODER_MCP_SETTINGS_FILE_NAME),
		);
	});

	it("falls back to ~/.bedrock-coder/.agents for agent configs", () => {
		snapshot = captureEnv();
		process.env.BEDROCK_CODER_DIR = "/tmp/home/.bedrock-coder";

		expect(resolveAgentsConfigDirPath()).toBe(
			join("/tmp/home", ".bedrock-coder", AGENT_CONFIG_DIRECTORY_NAME),
		);
	});

	it("resolves global hooks from ~/.bedrock-coder", () => {
		snapshot = captureEnv();
		process.env.BEDROCK_CODER_DIR = "/tmp/home/.bedrock-coder";
		process.env.BEDROCK_CODER_DATA_DIR = "/tmp/home/.bedrock-coder/data";

		expect(resolveHooksConfigSearchPaths()).toEqual(
			expect.arrayContaining([
				join("/tmp/home", ".bedrock-coder", HOOKS_CONFIG_DIRECTORY_NAME),
			]),
		);
		expect(resolveHooksConfigSearchPaths()).not.toContain(
			join("/tmp/home", ".bedrock-coder", "data", HOOKS_CONFIG_DIRECTORY_NAME),
		);
	});

	it("resolves global rules from ~/.bedrock-coder", () => {
		snapshot = captureEnv();
		process.env.BEDROCK_CODER_DIR = "/tmp/home/.bedrock-coder";
		process.env.BEDROCK_CODER_DATA_DIR = "/tmp/home/.bedrock-coder/data";

		expect(resolveRulesConfigSearchPaths()).toEqual(
			expect.arrayContaining([
				resolveGlobalAgentsRulesPath(),
				join("/tmp/home", ".bedrock-coder", RULES_CONFIG_DIRECTORY_NAME),
			]),
		);
		expect(resolveRulesConfigSearchPaths()).not.toContain(
			join("/tmp/home", ".bedrock-coder", "data", RULES_CONFIG_DIRECTORY_NAME),
		);
	});

	it("resolves legacy and new workflow paths, with .bedrock-coder paths later for duplicate-name precedence", () => {
		snapshot = captureEnv();
		process.env.BEDROCK_CODER_DIR = "/tmp/home/.bedrock-coder";
		const workspacePath = "/repo/demo";

		const paths = resolveWorkflowsConfigSearchPaths(workspacePath);

		expect(paths).toEqual([
			join(workspacePath, ".bedrock-coder", "workflows"),
			expect.stringContaining(join("Documents", "Bedrock Coder", "Workflows")),
			join("/tmp/home", ".bedrock-coder", "workflows"),
			join(workspacePath, ".bedrock-coder", "workflows"),
		]);
	});
});

describe("chat workspace paths", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
	});

	it("exports the canonical path segments", () => {
		expect(BEDROCK_CODER_WORKSPACES_DIRECTORY_NAME).toBe("workspaces");
		expect(BEDROCK_CODER_CHAT_WORKSPACE_DIRECTORY_NAME).toBe("chat");
	});

	it("resolves the shared chat workspace under the bedrockCoder data dir", () => {
		snapshot = captureEnv();
		delete process.env.BEDROCK_CODER_DATA_DIR;
		process.env.BEDROCK_CODER_DIR = "/tmp/home/.bedrock-coder";

		expect(resolveChatWorkspacePath()).toBe(
			join("/tmp/home/.bedrock-coder", "data", "workspaces", "chat"),
		);
	});

	it("honors the BEDROCK_CODER_DATA_DIR override", () => {
		snapshot = captureEnv();
		process.env.BEDROCK_CODER_DATA_DIR = "/tmp/bedrock-coder-data";

		expect(resolveChatWorkspacePath()).toBe(
			join("/tmp/bedrock-coder-data", "workspaces", "chat"),
		);
	});

	it.each([
		"/home/user/.bedrock-coder/data/workspaces/chat",
		"//home//user//.bedrock-coder//data//workspaces//chat//",
		"C:\\Users\\dev\\.bedrock-coder\\data\\workspaces\\chat\\",
		"\\\\server\\share\\.bedrock-coder\\data\\workspaces\\chat",
	])("recognizes chat workspace root %s", (path) => {
		expect(isChatWorkspacePath(path)).toBe(true);
	});

	it.each([
		".bedrock-coder/data/workspaces/chat",
		"/tmp/chat",
		"/tmp/bedrock-coder/sessions/session-a1b2c3-temp/project",
		"/home/user/bedrock-coder/data/workspaces/chat",
		"/home/user/.bedrock-coder/workspaces/chat",
		"/home/user/.bedrock-coder/data/other/chat",
		"/home/user/.bedrock-coder/data/workspaces/Chat",
		"/home/user/.bedrock-coder/data/workspaces/chat/my-app",
		"/home/user/.bedrock-coder/data/workspaces",
	])("rejects non-chat workspace path %s", (path) => {
		expect(isChatWorkspacePath(path)).toBe(false);
	});
});
