import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInstallOptions, PluginInstallResult } from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getOfficialPluginInstallPath,
	installMarketplaceEntry,
	listMarketplaceInstalledEntries,
} from "./marketplace";
import type { JsonRecord } from "./types";

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

function fakePluginInstaller(overrides: Partial<PluginInstallResult> = {}) {
	return vi.fn(
		async (options: PluginInstallOptions): Promise<PluginInstallResult> => ({
			source: options.source,
			installPath: goalInstallDir(),
			entryPaths: [],
			mcpSyncFailures: [],
			mcpOAuthCandidates: [],
			...overrides,
		}),
	);
}

describe("official plugin install detection", () => {
	it("installs plugins in-process instead of shelling out to a cline binary", async () => {
		// Regression: the packaged desktop app spawned `cline plugin install`,
		// which fails with 'Executable not found in $PATH: "cline"' when no
		// CLI is installed (or when the GUI app inherits launchd's minimal
		// PATH on macOS).
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));
		const installPlugin = fakePluginInstaller();

		const result = await installMarketplaceEntry(
			{ entry: GOAL_ENTRY },
			{ spawnCommand, installPlugin },
		);

		expect(result).toMatchObject({
			status: "installed",
			message: "Installed Goal.",
		});
		expect(installPlugin).toHaveBeenCalledWith({
			source: "goal",
			force: false,
		});
		expect(spawnCommand).not.toHaveBeenCalled();
	});

	it("does not treat a leftover empty install directory as installed", async () => {
		// Regression: a failed or interrupted install can leave the directory
		// behind with nothing in it. The next install attempt then returned
		// "already installed" without running the installer, so the UI flipped
		// the entry to Uninstall with no error while nothing actually worked.
		await mkdir(goalInstallDir(), { recursive: true });
		const installPlugin = vi.fn(async () => {
			throw new Error("install exploded");
		});

		await expect(
			installMarketplaceEntry({ entry: GOAL_ENTRY }, { installPlugin }),
		).rejects.toThrow(/install exploded/);
		expect(installPlugin).toHaveBeenCalledTimes(1);
	});

	it("passes force so a retry can reclaim the leftover directory", async () => {
		// Without force the installer refuses to replace the existing path
		// ("Plugin is already installed at ... Use --force to replace it."),
		// so every retry from the UI would fail against the stale directory.
		await mkdir(goalInstallDir(), { recursive: true });
		const installPlugin = fakePluginInstaller();

		const result = await installMarketplaceEntry(
			{ entry: GOAL_ENTRY },
			{ installPlugin },
		);

		expect(result).toMatchObject({
			status: "installed",
			message: "Installed Goal.",
		});
		expect(installPlugin).toHaveBeenCalledWith({
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
		const installPlugin = fakePluginInstaller();

		const result = await installMarketplaceEntry(
			{ entry: GOAL_ENTRY },
			{ installPlugin },
		);

		expect(result).toMatchObject({
			status: "installed",
			message: "Goal is already installed.",
		});
		expect(installPlugin).not.toHaveBeenCalled();
	});

	it("registers MCP servers in-process, honoring the -- args separator", async () => {
		const settingsPath = join(tempClineDir, "cline_mcp_settings.json");
		const previousSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));
		try {
			const result = await installMarketplaceEntry(
				{
					entry: {
						id: "aikido",
						type: "mcp",
						name: "Aikido",
						install: {
							args: ["aikido", "--", "npx", "-y", "@aikidosec/mcp@1.0.9"],
						},
					},
				},
				{ spawnCommand },
			);

			expect(result).toMatchObject({
				status: "installed",
				message: "Installed Aikido.",
			});
			expect(spawnCommand).not.toHaveBeenCalled();
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
});
