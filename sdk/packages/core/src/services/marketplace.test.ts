import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uninstallMarketplaceEntry } from "./marketplace";

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
		rmSync(root, { recursive: true, force: true });
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

	it("uninstalls marketplace skills in-process without spawning the skills CLI", async () => {
		const skillDir = join(home, ".agents", "skills", "review-team");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			"---\nname: Review\n---\n",
			"utf8",
		);
		const lockPath = join(home, ".agents", ".skill-lock.json");
		await writeFile(
			lockPath,
			JSON.stringify({
				version: 3,
				skills: { "review-team": { source: "cline/skills" }, other: {} },
			}),
			"utf8",
		);
		const spawnCommand = vi.fn();

		const result = await uninstallMarketplaceEntry(
			{
				id: "review-team",
				type: "skill",
				name: "Review Team",
				install: {
					args: ["github.com/cline/skills@review-team"],
				},
			},
			{ spawnCommand },
		);

		expect(result).toMatchObject({
			id: "review-team",
			type: "skill",
			status: "uninstalled",
			message: "Uninstalled Review Team.",
			output: `Removed: ${skillDir}`,
		});
		expect(spawnCommand).not.toHaveBeenCalled();
		expect(existsSync(skillDir)).toBe(false);
		expect(JSON.parse(readFileSync(lockPath, "utf8")).skills).toEqual({
			other: {},
		});
	});

	it("removes marketplace skills from every global skills directory", async () => {
		const clineSkillDir = join(
			process.env.CLINE_DIR ?? "",
			"skills",
			"review-team",
		);
		const agentsSkillDir = join(home, ".agents", "skills", "review-team");
		for (const dir of [clineSkillDir, agentsSkillDir]) {
			await mkdir(dir, { recursive: true });
			await writeFile(join(dir, "SKILL.md"), "# Review Team", "utf8");
		}

		const result = await uninstallMarketplaceEntry({
			id: "review-team",
			type: "skill",
			name: "Review Team",
			install: { args: ["github.com/cline/skills@review-team"] },
		});

		expect(result.status).toBe("uninstalled");
		expect(result.output).toContain(`Removed: ${clineSkillDir}`);
		expect(result.output).toContain(`Removed: ${agentsSkillDir}`);
		expect(existsSync(clineSkillDir)).toBe(false);
		expect(existsSync(agentsSkillDir)).toBe(false);
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
