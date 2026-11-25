import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import {
	claudeCodeProjectsDir,
	codexHomeDir,
	cursorUserDir,
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
			HOMEDRIVE: "D:",
			HOMEPATH: String.raw`\Profiles\Other`,
		});

		expect(claudeCodeProjectsDir(environment)).toBe(
			String.raw`C:\Users\Alice\.claude\projects`,
		);
		expect(codexHomeDir(environment)).toBe(String.raw`C:\Users\Alice\.codex`);
		expect(opencodeDataDir(environment)).toBe(
			String.raw`C:\Users\Alice\.local\share\opencode`,
		);
		expect(cursorUserDir(environment)).toBe(
			String.raw`C:\Users\Alice\AppData\Roaming\Cursor\User`,
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
		expect(cursorUserDir(environment)).toBe(
			String.raw`D:\Profiles\Alice\AppData\Roaming\Cursor\User`,
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

	it("uses APPDATA for the Cursor user dir and falls back to the profile", () => {
		const withAppData = windowsEnvironment({
			USERPROFILE: String.raw`C:\Users\Alice`,
			APPDATA: String.raw`D:\Roaming`,
		});
		expect(cursorUserDir(withAppData)).toBe(String.raw`D:\Roaming\Cursor\User`);

		const withoutAppData = windowsEnvironment({
			USERPROFILE: String.raw`C:\Users\Alice`,
			APPDATA: " ",
		});
		expect(cursorUserDir(withoutAppData)).toBe(
			String.raw`C:\Users\Alice\AppData\Roaming\Cursor\User`,
		);
	});

	it("supports a home at the drive root", () => {
		const environment = windowsEnvironment({
			HOMEDRIVE: "D:",
			HOMEPATH: "\\",
		});

		expect(codexHomeDir(environment)).toBe(String.raw`D:\.codex`);
	});

	it("falls back to the runtime home directory without profile variables", () => {
		const environment = windowsEnvironment({});
		environment.homeDir = String.raw`C:\RuntimeHome`;

		expect(codexHomeDir(environment)).toBe(String.raw`C:\RuntimeHome\.codex`);
		expect(cursorUserDir(environment)).toBe(
			String.raw`C:\RuntimeHome\AppData\Roaming\Cursor\User`,
		);
	});

	it("preserves whitespace in nonblank overrides", () => {
		const environment = windowsEnvironment({
			CLAUDE_CONFIG_DIR: String.raw`D:\Claude Data `,
			CODEX_HOME: String.raw`\\server\share\Codex `,
			XDG_DATA_HOME: String.raw`E:\XDG Data `,
		});

		expect(claudeCodeProjectsDir(environment)).toBe(
			String.raw`D:\Claude Data \projects`,
		);
		expect(codexHomeDir(environment)).toBe(String.raw`\\server\share\Codex `);
		expect(opencodeDataDir(environment)).toBe(
			String.raw`E:\XDG Data \opencode`,
		);
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
		expect(cursorUserDir(environment)).toBe(
			String.raw`C:\Users\Alice\AppData\Roaming\Cursor\User`,
		);
	});
});

describe("POSIX session import paths", () => {
	it.each([
		"/mnt/store ",
		" relative store ",
	])("preserves surrounding whitespace in %j", (path) => {
		const environment = posixEnvironment({
			CLAUDE_CONFIG_DIR: path,
			CODEX_HOME: path,
			XDG_DATA_HOME: path,
		});

		expect(claudeCodeProjectsDir(environment)).toBe(`${path}/projects`);
		expect(codexHomeDir(environment)).toBe(path);
		expect(opencodeDataDir(environment)).toBe(`${path}/opencode`);
	});

	it.each(["", " \t "])("ignores blank overrides %j", (value) => {
		const environment = posixEnvironment({
			CLAUDE_CONFIG_DIR: value,
			CODEX_HOME: value,
			XDG_DATA_HOME: value,
		});

		expect(claudeCodeProjectsDir(environment)).toBe(
			"/home/alice/.claude/projects",
		);
		expect(codexHomeDir(environment)).toBe("/home/alice/.codex");
		expect(opencodeDataDir(environment)).toBe(
			"/home/alice/.local/share/opencode",
		);
		expect(cursorUserDir(environment)).toBe("/home/alice/.config/Cursor/User");
	});

	it("uses the home directory for default tool stores", () => {
		const environment = posixEnvironment({ USERPROFILE: "/windows/profile" });

		expect(claudeCodeProjectsDir(environment)).toBe(
			"/home/alice/.claude/projects",
		);
		expect(codexHomeDir(environment)).toBe("/home/alice/.codex");
		expect(opencodeDataDir(environment)).toBe(
			"/home/alice/.local/share/opencode",
		);
		expect(cursorUserDir(environment)).toBe("/home/alice/.config/Cursor/User");
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

	it("uses XDG_CONFIG_HOME for the Cursor user dir and ignores a blank override", () => {
		expect(
			cursorUserDir(posixEnvironment({ XDG_CONFIG_HOME: "/mnt/config" })),
		).toBe("/mnt/config/Cursor/User");
		expect(cursorUserDir(posixEnvironment({ XDG_CONFIG_HOME: " \t " }))).toBe(
			"/home/alice/.config/Cursor/User",
		);
	});
});

describe("darwin Cursor paths", () => {
	it("uses Application Support for the user dir", () => {
		const environment: SessionImportPathEnvironment = {
			platform: "darwin",
			homeDir: "/Users/alice",
			env: { XDG_CONFIG_HOME: "/mnt/xdg" },
			joinPath: posix.join,
		};
		expect(cursorUserDir(environment)).toBe(
			"/Users/alice/Library/Application Support/Cursor/User",
		);
	});
});
