import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	AGENT_CONFIG_DIRECTORY_NAME,
	CLINE_CONNECTOR_SETTINGS_FILE_NAME,
	CLINE_MCP_SETTINGS_FILE_NAME,
	CLINE_TEMPORARY_WORKSPACE_PROJECT_DIRECTORY,
	CLINE_TEMPORARY_WORKSPACE_ROOT_DIRECTORY,
	CLINE_TEMPORARY_WORKSPACE_SESSION_DIRECTORY_SUFFIX,
	CLINE_TEMPORARY_WORKSPACE_SESSIONS_DIRECTORY,
	HOOKS_CONFIG_DIRECTORY_NAME,
	isTemporaryWorkspacePath,
	RULES_CONFIG_DIRECTORY_NAME,
	resolveAgentsConfigDirPath,
	resolveClineDataDir,
	resolveConnectorDataDir,
	resolveConnectorSettingsPath,
	resolveDbDataDir,
	resolveGlobalAgentsRulesPath,
	resolveGlobalSettingsPath,
	resolveHooksConfigSearchPaths,
	resolveMcpSettingsPath,
	resolveProviderSettingsPath,
	resolveRulesConfigSearchPaths,
	resolveSessionDataDir,
	resolveTeamDataDir,
	resolveTemporaryWorkspacePath,
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

describe("temporary workspace paths", () => {
	it("exports the canonical path segments", () => {
		expect(CLINE_TEMPORARY_WORKSPACE_ROOT_DIRECTORY).toBe("cline");
		expect(CLINE_TEMPORARY_WORKSPACE_SESSIONS_DIRECTORY).toBe("sessions");
		expect(CLINE_TEMPORARY_WORKSPACE_SESSION_DIRECTORY_SUFFIX).toBe("-temp");
		expect(CLINE_TEMPORARY_WORKSPACE_PROJECT_DIRECTORY).toBe("project");
	});

	it("resolves the session workspace under the system temp directory", () => {
		const sessionId = "1700000000000_a1b2c";
		expect(resolveTemporaryWorkspacePath(sessionId)).toBe(
			join(tmpdir(), "cline", "sessions", `${sessionId}-temp`, "project"),
		);
	});

	it.each([
		"/tmp/cline/sessions/session-a1b2c3-temp/project",
		"//tmp//cline//sessions//session-a1b2c3-temp//project//",
		"C:\\Temp\\cline\\sessions\\session-a1b2c3-temp\\project\\",
		"\\\\server\\share\\cline\\sessions\\session-a1b2c3-temp\\project",
		"/tmp/cline/sessions/session-temp-temp/project",
	])("recognizes temporary workspace root %s", (path) => {
		expect(isTemporaryWorkspacePath(path)).toBe(true);
	});

	it.each([
		"cline/sessions/session-a1b2c3-temp/project",
		"/tmp/project",
		"/tmp/cline-temp-workspaces/cline-temp-cwd-session-a1b2c3/project",
		"/tmp/other/sessions/session-a1b2c3-temp/project",
		"/tmp/cline/other/session-a1b2c3-temp/project",
		"/tmp/cline/sessions/-temp/project",
		"/tmp/cline/sessions/session-a1b2c3/project",
		"/tmp/cline/sessions/session-a1b2c3-temp-copy/project",
		"/tmp/cline/sessions/session with spaces-temp/project",
		"/tmp/cline/sessions/session-a1b2c3-temp",
		"/tmp/cline/sessions/session-a1b2c3-temp/Project",
		"/tmp/cline/sessions/session-a1b2c3-temp/project/src",
	])("rejects non-temporary workspace path %s", (path) => {
		expect(isTemporaryWorkspacePath(path)).toBe(false);
	});

	it.each([
		"../outside",
		"session\\outside",
		"session with spaces",
	])("rejects unsafe session ID %s", (sessionId) => {
		expect(() => resolveTemporaryWorkspacePath(sessionId)).toThrow(
			"sessionId must contain only letters, numbers, underscores, or hyphens",
		);
	});
});
