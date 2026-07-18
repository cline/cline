import { describe, expect, it } from "vitest";
import { buildSkillsArgs, resolveNpxInvocation } from "./skill";

describe("buildSkillsArgs", () => {
	it("runs the skills package through npx with -y", () => {
		expect(buildSkillsArgs(["list"])).toEqual(["-y", "skills@latest", "list"]);
	});

	it("injects --agent cline for install-style subcommands", () => {
		expect(buildSkillsArgs(["install", "owner/repo"])).toEqual([
			"-y",
			"skills@latest",
			"add",
			"owner/repo",
			"--agent",
			"cline",
		]);
		expect(buildSkillsArgs(["add", "owner/repo"])).toContain("cline");
		expect(buildSkillsArgs(["i", "owner/repo"])).toContain("cline");
		expect(buildSkillsArgs(["update", "owner/repo"])).toContain("cline");
	});

	it("aliases uninstall to the skills remove subcommand", () => {
		expect(buildSkillsArgs(["uninstall", "my-skill"])).toEqual([
			"-y",
			"skills@latest",
			"remove",
			"my-skill",
			"--agent",
			"cline",
		]);
	});

	it("does not inject when the user already targeted an agent", () => {
		expect(
			buildSkillsArgs(["install", "owner/repo", "--agent", "cursor"]),
		).not.toContain("cline");
		expect(
			buildSkillsArgs(["install", "owner/repo", "-a", "cursor"]),
		).not.toContain("cline");
		expect(
			buildSkillsArgs(["install", "owner/repo", "--agent=cursor"]),
		).not.toContain("cline");
	});

	it("aliases install and uninstall when agent options come before the subcommand", () => {
		expect(
			buildSkillsArgs(["--agent", "cursor", "install", "owner/repo"]),
		).toEqual([
			"-y",
			"skills@latest",
			"--agent",
			"cursor",
			"add",
			"owner/repo",
		]);
		expect(
			buildSkillsArgs(["--agent=cursor", "uninstall", "my-skill"]),
		).toEqual(["-y", "skills@latest", "--agent=cursor", "remove", "my-skill"]);
	});

	it("does not scope non-install subcommands to cline", () => {
		expect(buildSkillsArgs(["use", "owner/repo"])).not.toContain("--agent");
		expect(buildSkillsArgs(["list"])).not.toContain("--agent");
	});

	it("scopes remove-style subcommands to cline", () => {
		expect(buildSkillsArgs(["remove"])).toEqual([
			"-y",
			"skills@latest",
			"remove",
			"--agent",
			"cline",
		]);
		expect(buildSkillsArgs(["rm", "my-skill"])).toContain("cline");
		expect(buildSkillsArgs(["r", "my-skill"])).toContain("cline");
	});

	it("ignores leading flags when detecting the subcommand", () => {
		expect(buildSkillsArgs(["--global", "install", "owner/repo"])).toContain(
			"cline",
		);
	});

	it("forwards an empty arg list unchanged", () => {
		expect(buildSkillsArgs([])).toEqual(["-y", "skills@latest"]);
	});
});

describe("resolveNpxInvocation", () => {
	it("keeps forwarded arguments out of a shell on non-Windows platforms", () => {
		expect(
			resolveNpxInvocation(
				["-y", "skills@latest", "add", "repo; touch /tmp/pwned"],
				{
					platform: "linux",
				},
			),
		).toEqual({
			command: "npx",
			args: ["-y", "skills@latest", "add", "repo; touch /tmp/pwned"],
		});
	});

	it("runs npm's npx CLI through node.exe on Windows", () => {
		const nodePath = "C:\\Program Files\\nodejs\\node.exe";
		const npxCliPath =
			"C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js";
		const existingFiles = new Set([nodePath, npxCliPath]);
		const injectedArg = "owner/repo & echo INJECTED";

		expect(
			resolveNpxInvocation(["-y", "skills@latest", "add", injectedArg], {
				platform: "win32",
				env: { Path: '"C:\\Program Files\\nodejs";C:\\Tools' },
				execPath: "C:\\Apps\\cline.exe",
				fileExists: (path) => existingFiles.has(path),
			}),
		).toEqual({
			command: nodePath,
			args: [npxCliPath, "-y", "skills@latest", "add", injectedArg],
		});
	});

	it("uses a native npx.exe shim on Windows when one is available", () => {
		const npxPath = "C:\\Tools\\npx.exe";
		expect(
			resolveNpxInvocation(["--version"], {
				platform: "win32",
				env: { Path: "C:\\Tools" },
				execPath: "C:\\Apps\\cline.exe",
				fileExists: (path) => path === npxPath,
			}),
		).toEqual({ command: npxPath, args: ["--version"] });
	});

	it("fails safely when Windows only exposes an unsafe command shim", () => {
		expect(
			resolveNpxInvocation(["list"], {
				platform: "win32",
				env: { Path: "C:\\Tools" },
				execPath: "C:\\Apps\\cline.exe",
				fileExists: (path) => path === "C:\\Tools\\npx.cmd",
			}),
		).toBeUndefined();
	});
});
