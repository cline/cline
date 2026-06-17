import { describe, expect, it } from "vitest";
import { buildSkillsArgs } from "./skill";

describe("buildSkillsArgs", () => {
	it("runs the skills package through npx with -y", () => {
		expect(buildSkillsArgs(["list"])).toEqual(["-y", "skills@latest", "list"]);
	});

	it("injects --agent cline for install-style subcommands", () => {
		expect(buildSkillsArgs(["install", "owner/repo"])).toEqual([
			"-y",
			"skills@latest",
			"install",
			"owner/repo",
			"--agent",
			"cline",
		]);
		expect(buildSkillsArgs(["add", "owner/repo"])).toContain("cline");
		expect(buildSkillsArgs(["i", "owner/repo"])).toContain("cline");
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

	it("does not scope non-install subcommands to cline", () => {
		expect(buildSkillsArgs(["use", "owner/repo"])).not.toContain("--agent");
		expect(buildSkillsArgs(["remove"])).not.toContain("--agent");
		expect(buildSkillsArgs(["list"])).not.toContain("--agent");
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
