import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import {
	claudeCodeProjectsDir,
	codexHomeDir,
	opencodeDataDir,
	type SessionImportPathEnvironment,
} from "./paths";

function windowsEnvironment(
	env: Record<string, string | undefined>,
): SessionImportPathEnvironment {
	return {
		platform: "win32",
		homeDir: "/home/inherited-from-shell",
		env,
		joinPath: win32.join,
	};
}

function posixEnvironment(
	env: Record<string, string | undefined>,
): SessionImportPathEnvironment {
	return {
		platform: "linux",
		homeDir: "/home/alice",
		env,
		joinPath: posix.join,
	};
}

describe("Windows session import paths", () => {
	it("uses USERPROFILE for each tool instead of an inherited Unix HOME", () => {
		const environment = windowsEnvironment({
			HOME: "/home/inherited-from-shell",
			USERPROFILE: String.raw`C:\Users\Alice`,
		});

		expect(claudeCodeProjectsDir(environment)).toBe(
			String.raw`C:\Users\Alice\.claude\projects`,
		);
		expect(codexHomeDir(environment)).toBe(String.raw`C:\Users\Alice\.codex`);
		expect(opencodeDataDir(environment)).toBe(
			String.raw`C:\Users\Alice\.local\share\opencode`,
		);
	});

	it("falls back to HOMEDRIVE and HOMEPATH", () => {
		const environment = windowsEnvironment({
			HOMEDRIVE: "D:",
			HOMEPATH: String.raw`\Profiles\Alice`,
		});

		expect(codexHomeDir(environment)).toBe(
			String.raw`D:\Profiles\Alice\.codex`,
		);
	});

	it("preserves tool-specific overrides", () => {
		const environment = windowsEnvironment({
			USERPROFILE: String.raw`C:\Users\Alice`,
			CLAUDE_CONFIG_DIR: String.raw`D:\Claude Data`,
			CODEX_HOME: String.raw`\\server\share\Codex`,
			XDG_DATA_HOME: String.raw`E:\XDG Data`,
		});

		expect(claudeCodeProjectsDir(environment)).toBe(
			String.raw`D:\Claude Data\projects`,
		);
		expect(codexHomeDir(environment)).toBe(String.raw`\\server\share\Codex`);
		expect(opencodeDataDir(environment)).toBe(String.raw`E:\XDG Data\opencode`);
	});

	it("ignores empty environment overrides", () => {
		const environment = windowsEnvironment({
			USERPROFILE: String.raw`C:\Users\Alice`,
			CLAUDE_CONFIG_DIR: " ",
			CODEX_HOME: "",
			XDG_DATA_HOME: " ",
		});

		expect(claudeCodeProjectsDir(environment)).toBe(
			String.raw`C:\Users\Alice\.claude\projects`,
		);
		expect(codexHomeDir(environment)).toBe(String.raw`C:\Users\Alice\.codex`);
		expect(opencodeDataDir(environment)).toBe(
			String.raw`C:\Users\Alice\.local\share\opencode`,
		);
	});
});

describe("POSIX session import paths", () => {
	it("uses the home directory for default tool stores", () => {
		const environment = posixEnvironment({ USERPROFILE: "/windows/profile" });

		expect(claudeCodeProjectsDir(environment)).toBe(
			"/home/alice/.claude/projects",
		);
		expect(codexHomeDir(environment)).toBe("/home/alice/.codex");
		expect(opencodeDataDir(environment)).toBe(
			"/home/alice/.local/share/opencode",
		);
	});

	it("preserves tool-specific overrides", () => {
		const environment = posixEnvironment({
			CLAUDE_CONFIG_DIR: "/mnt/claude",
			CODEX_HOME: "/mnt/codex",
			XDG_DATA_HOME: "/mnt/data",
		});

		expect(claudeCodeProjectsDir(environment)).toBe("/mnt/claude/projects");
		expect(codexHomeDir(environment)).toBe("/mnt/codex");
		expect(opencodeDataDir(environment)).toBe("/mnt/data/opencode");
	});
});
