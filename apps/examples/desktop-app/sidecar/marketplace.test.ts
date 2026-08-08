import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("official plugin install detection", () => {
	it("does not treat a leftover empty install directory as installed", async () => {
		// Regression: a failed or interrupted install can leave the directory
		// behind with nothing in it. The next install attempt then returned
		// "already installed" without running the CLI, so the UI flipped the
		// entry to Uninstall with no error while nothing actually worked.
		await mkdir(goalInstallDir(), { recursive: true });
		const spawnCommand = vi.fn(async () => ({
			exitCode: 1,
			stdout: "",
			stderr: "install exploded",
		}));

		await expect(
			installMarketplaceEntry({ entry: GOAL_ENTRY }, { spawnCommand }),
		).rejects.toThrow(/Plugin install failed/);
		expect(spawnCommand).toHaveBeenCalledTimes(1);
	});

	it("passes --force so a retry can reclaim the leftover directory", async () => {
		// Without --force the CLI refuses to replace the existing path
		// ("Plugin is already installed at ... Use --force to replace it."),
		// so every retry from the UI would fail against the stale directory.
		await mkdir(goalInstallDir(), { recursive: true });
		const spawnCommand = vi.fn(async (_command: string, _args: string[]) => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));

		const result = await installMarketplaceEntry(
			{ entry: GOAL_ENTRY },
			{ spawnCommand },
		);

		expect(result).toMatchObject({
			status: "installed",
			message: "Installed Goal.",
		});
		expect(spawnCommand.mock.calls[0]?.[1]).toContain("--force");
	});

	it("does not pass --force for a clean first install", async () => {
		const spawnCommand = vi.fn(async (_command: string, _args: string[]) => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));

		await installMarketplaceEntry({ entry: GOAL_ENTRY }, { spawnCommand });

		expect(spawnCommand.mock.calls[0]?.[1]).not.toContain("--force");
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
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));

		const result = await installMarketplaceEntry(
			{ entry: GOAL_ENTRY },
			{ spawnCommand },
		);

		expect(result).toMatchObject({
			status: "installed",
			message: "Goal is already installed.",
		});
		expect(spawnCommand).not.toHaveBeenCalled();
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
