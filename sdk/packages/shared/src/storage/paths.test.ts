import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	AGENT_CONFIG_DIRECTORY_NAME,
	CLINE_CONNECTOR_SETTINGS_FILE_NAME,
	CLINE_MCP_SETTINGS_FILE_NAME,
	HOOKS_CONFIG_DIRECTORY_NAME,
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
	resolveWorkflowsConfigSearchPaths,
} from "./paths";

type EnvSnapshot = {
	CLINE_DIR: string | undefined;
	CLINE_DATA_DIR: string | undefined;
	CLINE_CONNECTOR_DATA_DIR: string | undefined;
	CLINE_CONNECTOR_SETTINGS_PATH: string | undefined;
	CLINE_DB_DATA_DIR: string | undefined;
	CLINE_GLOBAL_SETTINGS_PATH: string | undefined;
	CLINE_ENVIRONMENT: string | undefined;
	CLINE_ENVIRONMENT_OVERRIDE: string | undefined;
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
		CLINE_ENVIRONMENT: process.env.CLINE_ENVIRONMENT,
		CLINE_ENVIRONMENT_OVERRIDE: process.env.CLINE_ENVIRONMENT_OVERRIDE,
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
	process.env.CLINE_ENVIRONMENT = snapshot.CLINE_ENVIRONMENT;
	process.env.CLINE_ENVIRONMENT_OVERRIDE = snapshot.CLINE_ENVIRONMENT_OVERRIDE;
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
		delete process.env.CLINE_ENVIRONMENT;
		delete process.env.CLINE_ENVIRONMENT_OVERRIDE;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveProviderSettingsPath()).toBe(
			join("/tmp/cline-data", "settings", "providers.json"),
		);
	});

	it("resolves staging provider settings as a full replacement file", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_PROVIDER_SETTINGS_PATH;
		delete process.env.CLINE_ENVIRONMENT_OVERRIDE;
		process.env.CLINE_ENVIRONMENT = "staging";
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveProviderSettingsPath()).toBe(
			join("/tmp/cline-data", "settings", "providers.staging.json"),
		);
	});

	it("resolves local provider settings as a full replacement file", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_PROVIDER_SETTINGS_PATH;
		delete process.env.CLINE_ENVIRONMENT_OVERRIDE;
		process.env.CLINE_ENVIRONMENT = "local";
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveProviderSettingsPath()).toBe(
			join("/tmp/cline-data", "settings", "providers.local.json"),
		);
	});

	it("keeps explicit provider settings path precedence over environment", () => {
		snapshot = captureEnv();
		process.env.CLINE_PROVIDER_SETTINGS_PATH = "/tmp/custom-providers.json";
		process.env.CLINE_ENVIRONMENT = "staging";
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveProviderSettingsPath()).toBe("/tmp/custom-providers.json");
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
