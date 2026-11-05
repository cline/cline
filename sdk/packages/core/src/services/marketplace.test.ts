import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	installMarketplaceSkill,
	uninstallMarketplaceEntry,
} from "./marketplace";
import { SKILLS_CLI_PACKAGE } from "./skills-cli";

describe("marketplace service", () => {
	let root = "";
	let home = "";
	let originalHome: string | undefined;
	let originalClineDir: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "core-marketplace-"));
		home = join(root, "home");
		originalHome = process.env.HOME;
		originalClineDir = process.env.CLINE_DIR;
		process.env.HOME = home;
		process.env.CLINE_DIR = join(home, ".cline");
		setHomeDir(home);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		if (originalClineDir === undefined) {
			delete process.env.CLINE_DIR;
		} else {
			process.env.CLINE_DIR = originalClineDir;
		}
		setHomeDir(originalHome || homedir());
		setClineDir(originalClineDir || join(homedir(), ".cline"));
		rmSync(root, { recursive: true, force: true });
	});

	const skill = {
		id: "review-team",
		type: "skill" as const,
		install: { args: ["github.com/cline/skills@review-team"] },
	};
	it("installs skills globally using the shared CLI and skips an existing install", async () => {
		const spawnCommand = vi.fn(async () => {
			const dir = join(home, ".agents", "skills", "review-team");
			await mkdir(dir, { recursive: true });
			await writeFile(join(dir, "SKILL.md"), "# Review");
			return { exitCode: 0, stdout: "installed\napi_key=secret", stderr: "" };
		});
		expect(
			await installMarketplaceSkill(skill, { spawnCommand }),
		).toMatchObject({
			status: "installed",
			output: "installed\napi_key=[redacted]",
		});
		expect(spawnCommand).toHaveBeenCalledWith("npx", [
			"-y",
			SKILLS_CLI_PACKAGE,
			"add",
			...skill.install.args,
			"-g",
			"-a",
			"cline",
			"-y",
		]);
		await installMarketplaceSkill(skill, { spawnCommand });
		expect(spawnCommand).toHaveBeenCalledTimes(1);
	});
	it.each([
		[1, "spawn git ENOENT", "Git is required"],
		[1, "Network request failed", "Network request failed"],
		[0, "Failed to install skill", "Skill install failed"],
		[0, "done", "was not found"],
	])("rejects unsuccessful skill installs (%s, %s)", async (exitCode, stderr, message) => {
		await expect(
			installMarketplaceSkill(skill, {
				spawnCommand: async () => ({ exitCode, stdout: "", stderr }),
			}),
		).rejects.toThrow(message);
	});

	it("uninstalls marketplace MCP servers from settings by default", async () => {
		const settingsPath = join(root, "cline_mcp_settings.json");
		await writeFile(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						context7: { transport: { type: "stdio", command: "node" } },
						other: { transport: { type: "stdio", command: "node" } },
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const result = await uninstallMarketplaceEntry(
			{
				id: "context7",
				type: "mcp",
				name: "Context7",
				install: { args: ["context7", "node", "server.js"] },
			},
			{ mcpSettingsPath: settingsPath },
		);

		expect(result).toMatchObject({
			id: "context7",
			type: "mcp",
			status: "uninstalled",
			message: "Uninstalled Context7.",
		});
		const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
			mcpServers?: Record<string, unknown>;
		};
		expect(settings.mcpServers?.context7).toBeUndefined();
		expect(settings.mcpServers?.other).toBeDefined();
	});

	it("uninstalls marketplace skills through skills CLI remove", async () => {
		const skillDir = join(home, ".agents", "skills", "review-team");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			"---\nname: Review\n---\n",
			"utf8",
		);
		const calls: Array<{ command: string; args: string[] }> = [];

		const result = await uninstallMarketplaceEntry(
			{
				id: "review-team",
				type: "skill",
				name: "Review Team",
				install: {
					args: ["github.com/cline/skills@review-team"],
				},
			},
			{
				spawnCommand: async (command, args) => {
					calls.push({ command, args });
					rmSync(skillDir, { recursive: true, force: true });
					return { exitCode: 0, stdout: "removed", stderr: "" };
				},
			},
		);

		expect(result).toMatchObject({
			id: "review-team",
			type: "skill",
			status: "uninstalled",
			message: "Uninstalled Review Team.",
		});
		expect(calls).toEqual([
			{
				command: "npx",
				args: ["-y", SKILLS_CLI_PACKAGE, "remove", "review-team", "-g", "-y"],
			},
		]);
		expect(existsSync(skillDir)).toBe(false);
	});

	it("cleans up remaining marketplace skill directories after skills CLI remove succeeds", async () => {
		const clineSkillDir = join(
			process.env.CLINE_DIR ?? "",
			"skills",
			"review-team",
		);
		await mkdir(clineSkillDir, { recursive: true });
		await writeFile(join(clineSkillDir, "SKILL.md"), "# Review Team", "utf8");

		const result = await uninstallMarketplaceEntry(
			{
				id: "review-team",
				type: "skill",
				name: "Review Team",
				install: { args: ["github.com/cline/skills@review-team"] },
			},
			{
				spawnCommand: async () => ({
					exitCode: 0,
					stdout: "removed",
					stderr: "",
				}),
			},
		);

		expect(result.status).toBe("uninstalled");
		expect(result.output).toContain(`Removed: ${clineSkillDir}`);
		expect(existsSync(clineSkillDir)).toBe(false);
	});

	it("uninstalls official marketplace plugins by marketplace slug", async () => {
		const installPath = join(
			home,
			".cline",
			"plugins",
			"_installed",
			"official",
			"goal-123456789abc",
		);
		const entryPath = join(installPath, "package", "index.ts");
		await mkdir(join(installPath, "package"), { recursive: true });
		await writeFile(
			join(installPath, "package.json"),
			JSON.stringify({ name: "goal" }, null, 2),
			"utf8",
		);
		await writeFile(
			entryPath,
			"export default { name: 'goal', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);

		const result = await uninstallMarketplaceEntry({
			id: "goal",
			type: "plugin",
			name: "Goal",
			install: { args: ["goal"] },
		});

		expect(result).toMatchObject({
			id: "goal",
			type: "plugin",
			status: "uninstalled",
			message: "Uninstalled Goal.",
		});
		expect(existsSync(installPath)).toBe(false);
	});
});
