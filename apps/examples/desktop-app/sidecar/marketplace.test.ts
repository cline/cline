import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installGitHubSkill, installPlugin } from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getOfficialPluginInstallPath,
	installMarketplaceEntry,
	listMarketplaceInstalledEntries,
} from "./marketplace";
import type { JsonRecord } from "./types";

// Marketplace plugin installs run in-process through @cline/core (spawning a
// `cline` binary fails with 'Executable not found in $PATH: "cline"' in the
// packaged app). Skills likewise install in-process instead of through
// `npx skills`. Stub only the network-facing installers; everything else
// stays real.
vi.mock(import("@cline/core"), async (importOriginal) => ({
	...(await importOriginal()),
	installPlugin: vi.fn(),
	installGitHubSkill: vi.fn(),
}));
const installPluginMock = vi.mocked(installPlugin);
const installGitHubSkillMock = vi.mocked(installGitHubSkill);

const GOAL_ENTRY = {
	id: "goal",
	type: "plugin",
	name: "Goal",
	install: { args: ["goal"] },
};

let tempClineDir: string;
let previousClineDir: string | undefined;

beforeEach(async () => {
	tempClineDir = await mkdtemp(join(tmpdir(), "desktop-marketplace-"));
	previousClineDir = process.env.CLINE_DIR;
	process.env.CLINE_DIR = tempClineDir;
	installPluginMock.mockReset().mockImplementation(async (options) => ({
		source: options.source,
		installPath: goalInstallDir(),
		entryPaths: [],
		mcpSyncFailures: [],
		mcpOAuthCandidates: [],
	}));
});

afterEach(async () => {
	if (previousClineDir === undefined) {
		delete process.env.CLINE_DIR;
	} else {
		process.env.CLINE_DIR = previousClineDir;
	}
	await rm(tempClineDir, { recursive: true, force: true });
});

function goalInstallDir(): string {
	const path = getOfficialPluginInstallPath("goal");
	if (!path) {
		throw new Error("expected an official install path for goal");
	}
	return path;
}

describe("official plugin install detection", () => {
	it("installs plugins in-process through @cline/core", async () => {
		const result = await installMarketplaceEntry({ entry: GOAL_ENTRY });

		expect(result).toMatchObject({
			status: "installed",
			message: "Installed Goal.",
		});
		expect(installPluginMock).toHaveBeenCalledWith({
			source: "goal",
			force: false,
		});
	});

	it("does not treat a leftover empty install directory as installed", async () => {
		// Regression: a failed or interrupted install can leave the directory
		// behind with nothing in it. The next install attempt then returned
		// "already installed" without running the installer, so the UI flipped
		// the entry to Uninstall with no error while nothing actually worked.
		await mkdir(goalInstallDir(), { recursive: true });
		installPluginMock.mockRejectedValueOnce(new Error("install exploded"));

		await expect(
			installMarketplaceEntry({ entry: GOAL_ENTRY }),
		).rejects.toThrow(/install exploded/);
		expect(installPluginMock).toHaveBeenCalledTimes(1);
	});

	it("passes force so a retry can reclaim the leftover directory", async () => {
		// Without force the installer refuses to replace the existing path
		// ("Plugin is already installed at ... Use --force to replace it."),
		// so every retry from the UI would fail against the stale directory.
		await mkdir(goalInstallDir(), { recursive: true });

		const result = await installMarketplaceEntry({ entry: GOAL_ENTRY });

		expect(result).toMatchObject({
			status: "installed",
			message: "Installed Goal.",
		});
		expect(installPluginMock).toHaveBeenCalledWith({
			source: "goal",
			force: true,
		});
	});

	it("still short-circuits when the directory contains a plugin module", async () => {
		const installDir = goalInstallDir();
		await mkdir(join(installDir, "package"), { recursive: true });
		await writeFile(
			join(installDir, "package.json"),
			JSON.stringify({
				name: "goal",
				private: true,
				cline: { plugins: [{ paths: ["./package/index.ts"] }] },
			}),
		);
		await writeFile(
			join(installDir, "package", "index.ts"),
			"export default {};",
		);

		const result = await installMarketplaceEntry({ entry: GOAL_ENTRY });

		expect(result).toMatchObject({
			status: "installed",
			message: "Goal is already installed.",
		});
		expect(installPluginMock).not.toHaveBeenCalled();
	});

	it("registers MCP servers in-process, honoring the -- args separator", async () => {
		const settingsPath = join(tempClineDir, "cline_mcp_settings.json");
		const previousSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		try {
			const result = await installMarketplaceEntry({
				entry: {
					id: "aikido",
					type: "mcp",
					name: "Aikido",
					install: {
						args: ["aikido", "--", "npx", "-y", "@aikidosec/mcp@1.0.9"],
					},
				},
			});

			expect(result).toMatchObject({
				status: "installed",
				message: "Installed Aikido.",
			});
			const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
				mcpServers: Record<string, { transport?: unknown }>;
			};
			expect(settings.mcpServers.aikido?.transport).toEqual({
				type: "stdio",
				command: "npx",
				args: ["-y", "@aikidosec/mcp@1.0.9"],
			});
		} finally {
			if (previousSettingsPath === undefined) {
				delete process.env.CLINE_MCP_SETTINGS_PATH;
			} else {
				process.env.CLINE_MCP_SETTINGS_PATH = previousSettingsPath;
			}
		}
	});

	it("excludes partial install directories from the installed entries list", async () => {
		await mkdir(goalInstallDir(), { recursive: true });

		const empty = listMarketplaceInstalledEntries({ entries: [GOAL_ENTRY] }, {
			plugins: [],
		} as JsonRecord);
		expect(empty.installedKeys).toEqual([]);

		const installDir = goalInstallDir();
		await mkdir(join(installDir, "package"), { recursive: true });
		await writeFile(
			join(installDir, "package", "index.ts"),
			"export default {};",
		);
		const populated = listMarketplaceInstalledEntries(
			{ entries: [GOAL_ENTRY] },
			{ plugins: [] } as JsonRecord,
		);
		expect(populated.installedKeys).toEqual(["plugin:goal"]);
	});

	it("does not match portable Agent Plugins to Cline marketplace entries", () => {
		const result = listMarketplaceInstalledEntries({ entries: [GOAL_ENTRY] }, {
			plugins: [
				{
					id: "agent-plugin:goal",
					name: "goal",
					path: "/home/user/.agents/plugins/goal",
					agentPlugin: true,
				},
			],
		} as JsonRecord);

		expect(result.installedKeys).toEqual([]);
	});
});

describe("marketplace skill install", () => {
	let tempHome: string;
	let previousHome: string | undefined;

	beforeEach(async () => {
		tempHome = await mkdtemp(join(tmpdir(), "desktop-marketplace-home-"));
		previousHome = process.env.HOME;
		process.env.HOME = tempHome;
		installGitHubSkillMock.mockReset().mockImplementation(async (source) => {
			const installPath = join(tempHome, ".agents", "skills", "review-team");
			await mkdir(installPath, { recursive: true });
			await writeFile(join(installPath, "SKILL.md"), "# Review Team");
			return {
				name: source.skill ?? "review-team",
				installPath,
				fileCount: 1,
				skippedPaths: ["skills/review-team/linked"],
			};
		});
	});

	afterEach(async () => {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		await rm(tempHome, { recursive: true, force: true });
	});

	const REVIEW_TEAM_ENTRY = {
		id: "review-team",
		type: "skill",
		name: "Review Team",
		install: { args: ["cline/skills", "--skill", "review-team"] },
	};

	it("installs GitHub skills in-process without spawning npx", async () => {
		const spawnCommand = vi.fn();

		const result = await installMarketplaceEntry(
			{ entry: REVIEW_TEAM_ENTRY },
			{ spawnCommand },
		);

		expect(installGitHubSkillMock).toHaveBeenCalledWith({
			owner: "cline",
			repo: "skills",
			skill: "review-team",
		});
		expect(spawnCommand).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			status: "installed",
			message: "Installed Review Team globally for Cline.",
		});
		expect(result.output).toContain("Skipped link: skills/review-team/linked");
	});

	it("surfaces download failures as a skill install error", async () => {
		installGitHubSkillMock.mockRejectedValueOnce(
			new Error("Could not download cline/skills from GitHub: HTTP 503"),
		);

		await expect(
			installMarketplaceEntry({ entry: REVIEW_TEAM_ENTRY }),
		).rejects.toThrow(
			"Skill install failed: Could not download cline/skills from GitHub: HTTP 503",
		);
	});

	it("falls back to the skills CLI for sources that are not on GitHub", async () => {
		const spawnCommand = vi.fn(async () => {
			const installPath = join(tempHome, ".agents", "skills", "local-skill");
			await mkdir(installPath, { recursive: true });
			await writeFile(join(installPath, "SKILL.md"), "# local");
			return { exitCode: 0, stdout: "done", stderr: "" };
		});

		await installMarketplaceEntry(
			{
				entry: {
					id: "local-skill",
					type: "skill",
					install: { args: ["https://gitlab.com/team/local-skill"] },
				},
			},
			{ spawnCommand },
		);

		expect(installGitHubSkillMock).not.toHaveBeenCalled();
		expect(spawnCommand).toHaveBeenCalledWith(
			"npx",
			expect.arrayContaining([
				"skills@latest",
				"add",
				"https://gitlab.com/team/local-skill",
			]),
		);
	});
});
