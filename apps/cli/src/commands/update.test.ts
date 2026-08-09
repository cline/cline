import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockEnsureCliHubServer, mockSpawn } = vi.hoisted(() => ({
	mockEnsureCliHubServer: vi.fn(),
	mockSpawn: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: mockSpawn,
	};
});

vi.mock("../utils/hub-runtime", () => ({
	ensureCliHubServer: mockEnsureCliHubServer,
}));

import { version as currentVersion } from "../../package.json";
import {
	autoUpdateOnStartup,
	checkForUpdates,
	ensureCliHubServerAfterUpdate,
	getInstallationInfo,
	getRollbackCommand,
	PackageManager,
	resolveCliHubOwnerContext,
	verifyCliInstallHealthy,
	withMinimumReleaseAgeBypass,
} from "./update";

const originalArgv = [...process.argv];
const originalBuildEnv = process.env.CLINE_BUILD_ENV;
const originalDataDir = process.env.CLINE_DATA_DIR;
const originalHubDiscoveryPath = process.env.CLINE_HUB_DISCOVERY_PATH;
const originalWrapperPath = process.env.CLINE_WRAPPER_PATH;
const originalGlobalSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH;
const originalIsDev = process.env.IS_DEV;
const originalNoAutoUpdate = process.env.CLINE_NO_AUTO_UPDATE;
const tempDirs: string[] = [];

function createChildProcessThatCloses(exitCode: number): ChildProcess {
	const child = new EventEmitter();
	queueMicrotask(() => {
		child.emit("close", exitCode);
	});
	return child as ChildProcess;
}

function createFile(path: string): string {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "");
	return path;
}

function createTempFile(pathSuffix: string): string {
	const root = mkdtempSync(join(tmpdir(), "cline-update-test-"));
	tempDirs.push(root);
	return createFile(join(root, pathSuffix));
}

describe("getInstallationInfo", () => {
	afterEach(() => {
		process.argv = [...originalArgv];
		if (originalBuildEnv === undefined) {
			delete process.env.CLINE_BUILD_ENV;
		} else {
			process.env.CLINE_BUILD_ENV = originalBuildEnv;
		}
		if (originalDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = originalDataDir;
		}
		if (originalHubDiscoveryPath === undefined) {
			delete process.env.CLINE_HUB_DISCOVERY_PATH;
		} else {
			process.env.CLINE_HUB_DISCOVERY_PATH = originalHubDiscoveryPath;
		}
		if (originalWrapperPath === undefined) {
			delete process.env.CLINE_WRAPPER_PATH;
		} else {
			process.env.CLINE_WRAPPER_PATH = originalWrapperPath;
		}
		if (originalGlobalSettingsPath === undefined) {
			delete process.env.CLINE_GLOBAL_SETTINGS_PATH;
		} else {
			process.env.CLINE_GLOBAL_SETTINGS_PATH = originalGlobalSettingsPath;
		}
		if (originalIsDev === undefined) {
			delete process.env.IS_DEV;
		} else {
			process.env.IS_DEV = originalIsDev;
		}
		if (originalNoAutoUpdate === undefined) {
			delete process.env.CLINE_NO_AUTO_UPDATE;
		} else {
			process.env.CLINE_NO_AUTO_UPDATE = originalNoAutoUpdate;
		}
		vi.restoreAllMocks();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("detects npm installs from the wrapper path passed to the compiled binary", () => {
		const wrapperPath = createTempFile("lib/node_modules/cline/bin/cline");
		process.env.CLINE_WRAPPER_PATH = wrapperPath;
		process.argv = ["bun", "/$bunfs/root/cline", "update", "--verbose"];

		expect(getInstallationInfo("1.2.3")).toEqual({
			packageManager: PackageManager.NPM,
			packageName: "cline",
			updateCommand: "npm update -g cline --tag latest",
		});
	});

	it("uses the nightly tag when the current CLI version is nightly", () => {
		const wrapperPath = createTempFile("lib/node_modules/cline/bin/cline");
		process.env.CLINE_WRAPPER_PATH = wrapperPath;
		process.argv = ["bun", "/$bunfs/root/cline", "update", "--verbose"];

		expect(getInstallationInfo("1.2.3-nightly.456")).toEqual({
			packageManager: PackageManager.NPM,
			packageName: "cline",
			updateCommand: "npm update -g cline --tag nightly",
		});
	});

	it("detects bun global installs from the resolved install path", () => {
		// bun symlinks ~/.bun/bin/cline -> ~/.bun/install/global/node_modules/...,
		// and realpathSync resolves through the symlink before detection runs.
		const wrapperPath = createTempFile(
			".bun/install/global/node_modules/cline/bin/cline",
		);
		process.env.CLINE_WRAPPER_PATH = wrapperPath;
		process.argv = ["bun", "/$bunfs/root/cline", "update", "--verbose"];

		expect(getInstallationInfo("1.2.3")).toEqual({
			packageManager: PackageManager.BUN,
			packageName: "cline",
			updateCommand: "bun add -g cline@latest",
		});
	});

	it("falls back to unknown when only Bun's virtual compiled path is available", () => {
		delete process.env.CLINE_WRAPPER_PATH;
		process.argv = ["bun", "/$bunfs/root/cline", "update", "--verbose"];

		expect(getInstallationInfo("1.2.3")).toEqual({
			packageManager: PackageManager.UNKNOWN,
			packageName: "cline",
		});
	});
});

describe("auto update settings", () => {
	afterEach(() => {
		process.argv = [...originalArgv];
		if (originalBuildEnv === undefined) {
			delete process.env.CLINE_BUILD_ENV;
		} else {
			process.env.CLINE_BUILD_ENV = originalBuildEnv;
		}
		if (originalDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = originalDataDir;
		}
		if (originalHubDiscoveryPath === undefined) {
			delete process.env.CLINE_HUB_DISCOVERY_PATH;
		} else {
			process.env.CLINE_HUB_DISCOVERY_PATH = originalHubDiscoveryPath;
		}
		if (originalWrapperPath === undefined) {
			delete process.env.CLINE_WRAPPER_PATH;
		} else {
			process.env.CLINE_WRAPPER_PATH = originalWrapperPath;
		}
		if (originalGlobalSettingsPath === undefined) {
			delete process.env.CLINE_GLOBAL_SETTINGS_PATH;
		} else {
			process.env.CLINE_GLOBAL_SETTINGS_PATH = originalGlobalSettingsPath;
		}
		if (originalIsDev === undefined) {
			delete process.env.IS_DEV;
		} else {
			process.env.IS_DEV = originalIsDev;
		}
		if (originalNoAutoUpdate === undefined) {
			delete process.env.CLINE_NO_AUTO_UPDATE;
		} else {
			process.env.CLINE_NO_AUTO_UPDATE = originalNoAutoUpdate;
		}
		vi.restoreAllMocks();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips startup auto update when disabled globally", () => {
		const settingsPath = createTempFile("data/global-settings.json");
		writeFileSync(settingsPath, JSON.stringify({ autoUpdateEnabled: false }));
		process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;
		delete process.env.IS_DEV;
		delete process.env.CLINE_NO_AUTO_UPDATE;
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("should not fetch"));

		autoUpdateOnStartup();

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("still lets manual update checks run when startup auto update is disabled", async () => {
		const settingsPath = createTempFile("data/global-settings.json");
		writeFileSync(settingsPath, JSON.stringify({ autoUpdateEnabled: false }));
		process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;
		delete process.env.CLINE_NO_AUTO_UPDATE;
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ version: "0.0.0" }),
		} as Response);

		await checkForUpdates({ includeKanban: false });

		expect(fetchSpy).toHaveBeenCalled();
	});
});

describe("hub restart owner selection", () => {
	afterEach(() => {
		if (originalBuildEnv === undefined) {
			delete process.env.CLINE_BUILD_ENV;
		} else {
			process.env.CLINE_BUILD_ENV = originalBuildEnv;
		}
		if (originalDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = originalDataDir;
		}
		if (originalHubDiscoveryPath === undefined) {
			delete process.env.CLINE_HUB_DISCOVERY_PATH;
		} else {
			process.env.CLINE_HUB_DISCOVERY_PATH = originalHubDiscoveryPath;
		}
	});

	it("uses the shared hub owner outside production builds", () => {
		process.env.CLINE_BUILD_ENV = "development";
		process.env.CLINE_DATA_DIR = "/tmp/cline-update-test-data";
		delete process.env.CLINE_HUB_DISCOVERY_PATH;

		const owner = resolveCliHubOwnerContext();

		expect(owner.discoveryPath).toContain("/locks/hub/owners/");
		expect(owner.discoveryPath).not.toBe(
			"/tmp/cline-update-test-data/locks/hub/production.json",
		);
	});
});

describe("post-update hub launch", () => {
	afterEach(() => {
		mockEnsureCliHubServer.mockReset();
		mockSpawn.mockReset();
	});

	it("uses the freshly installed wrapper instead of the current executable", async () => {
		mockSpawn.mockReturnValue(createChildProcessThatCloses(0));
		const env = {
			CLINE_WRAPPER_PATH: "/opt/cline/lib/node_modules/cline/bin/cline",
			CLINE_NO_AUTO_UPDATE: "0",
		};

		await ensureCliHubServerAfterUpdate("/workspace/project", env, "linux");

		expect(mockSpawn).toHaveBeenCalledWith(
			"/opt/cline/lib/node_modules/cline/bin/cline",
			["hub", "ensure"],
			{
				cwd: "/workspace/project",
				env: {
					...env,
					CLINE_NO_AUTO_UPDATE: "1",
				},
				stdio: "ignore",
				windowsHide: true,
			},
		);
		expect(mockEnsureCliHubServer).not.toHaveBeenCalled();
	});

	it("uses the in-process ensure path when no executable cache can be deleted", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});

		await ensureCliHubServerAfterUpdate(
			"C:\\workspace\\project",
			{ CLINE_WRAPPER_PATH: "C:\\npm\\node_modules\\cline\\bin\\cline" },
			"win32",
		);

		expect(mockEnsureCliHubServer).toHaveBeenCalledWith(
			"C:\\workspace\\project",
		);
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("surfaces a failure from the freshly installed CLI", async () => {
		mockSpawn.mockReturnValue(createChildProcessThatCloses(1));

		await expect(
			ensureCliHubServerAfterUpdate(
				"/workspace/project",
				{ CLINE_WRAPPER_PATH: "/opt/cline/bin/cline" },
				"linux",
			),
		).rejects.toThrow(
			"freshly installed Cline failed to start the hub (exit code 1)",
		);
	});
});

describe("getRollbackCommand", () => {
	it("pins the currently running version per package manager", () => {
		expect(
			getRollbackCommand(PackageManager.NPM, "cline", "1.2.3")?.command,
		).toBe("npm install -g cline@1.2.3 --min-release-age=0");
		expect(
			getRollbackCommand(PackageManager.PNPM, "cline", "1.2.3")?.command,
		).toBe("pnpm add -g cline@1.2.3");
		expect(
			getRollbackCommand(PackageManager.YARN, "cline", "1.2.3")?.command,
		).toBe("yarn global add cline@1.2.3");
		expect(
			getRollbackCommand(PackageManager.BUN, "cline", "1.2.3")?.command,
		).toBe("bun add -g cline@1.2.3 --minimum-release-age=0");
	});

	it("supports nightly versions and returns undefined for unmanaged installs", () => {
		expect(
			getRollbackCommand(PackageManager.NPM, "cline", "1.2.3-nightly.456")
				?.command,
		).toBe("npm install -g cline@1.2.3-nightly.456 --min-release-age=0");
		expect(
			getRollbackCommand(PackageManager.NPX, "cline", "1.2.3"),
		).toBeUndefined();
		expect(
			getRollbackCommand(PackageManager.UNKNOWN, "cline", "1.2.3"),
		).toBeUndefined();
	});
});

describe("verifyCliInstallHealthy", () => {
	afterEach(() => {
		mockSpawn.mockReset();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("passes when there is no wrapper to check (dev builds)", async () => {
		await expect(verifyCliInstallHealthy({}, "linux")).resolves.toBe(true);
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("fails when the wrapper script was deleted by a broken update", async () => {
		await expect(
			verifyCliInstallHealthy(
				{ CLINE_WRAPPER_PATH: "/nonexistent/lib/node_modules/cline/bin/cline" },
				"linux",
			),
		).resolves.toBe(false);
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("executes the wrapper on Unix and reports its exit code", async () => {
		const wrapperPath = createTempFile("lib/node_modules/cline/bin/cline");
		mockSpawn.mockReturnValue(createChildProcessThatCloses(0));

		await expect(
			verifyCliInstallHealthy({ CLINE_WRAPPER_PATH: wrapperPath }, "linux"),
		).resolves.toBe(true);

		expect(mockSpawn).toHaveBeenCalledWith(
			wrapperPath,
			["version"],
			expect.objectContaining({
				env: expect.objectContaining({ CLINE_NO_AUTO_UPDATE: "1" }),
				stdio: "ignore",
			}),
		);

		mockSpawn.mockReturnValue(createChildProcessThatCloses(1));
		await expect(
			verifyCliInstallHealthy({ CLINE_WRAPPER_PATH: wrapperPath }, "linux"),
		).resolves.toBe(false);
	});

	it("only checks wrapper existence on Windows", async () => {
		const wrapperPath = createTempFile("npm/node_modules/cline/bin/cline");

		await expect(
			verifyCliInstallHealthy({ CLINE_WRAPPER_PATH: wrapperPath }, "win32"),
		).resolves.toBe(true);
		expect(mockSpawn).not.toHaveBeenCalled();
	});
});

describe("checkForUpdates rollback", () => {
	afterEach(() => {
		process.argv = [...originalArgv];
		if (originalWrapperPath === undefined) {
			delete process.env.CLINE_WRAPPER_PATH;
		} else {
			process.env.CLINE_WRAPPER_PATH = originalWrapperPath;
		}
		if (originalDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = originalDataDir;
		}
		mockSpawn.mockReset();
		vi.restoreAllMocks();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function setupNpmInstall(): string {
		const wrapperPath = createTempFile("lib/node_modules/cline/bin/cline");
		process.env.CLINE_WRAPPER_PATH = wrapperPath;
		process.env.CLINE_DATA_DIR = dirname(wrapperPath);
		process.argv = ["bun", "/$bunfs/root/cline", "update"];
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ version: "999.0.0" }),
		} as Response);
		return wrapperPath;
	}

	it("restores the previous version when a failed update breaks the install", async () => {
		const wrapperPath = setupNpmInstall();
		const spawnedCommands: string[] = [];
		mockSpawn.mockImplementation((command: string) => {
			spawnedCommands.push(command);
			if (command.startsWith("npm update -g cline")) {
				// Simulate npm deleting the previous install before failing.
				rmSync(wrapperPath, { force: true });
				return createChildProcessThatCloses(1);
			}
			if (command.startsWith("npm install -g cline@")) {
				// Rollback reinstalls the wrapper.
				createFile(wrapperPath);
				return createChildProcessThatCloses(0);
			}
			// Post-rollback health check through the wrapper.
			return createChildProcessThatCloses(0);
		});

		const exitCode = await checkForUpdates({ includeKanban: false });

		expect(exitCode).toBe(1);
		expect(spawnedCommands[0]).toBe(
			"npm update -g cline --tag latest --min-release-age=0",
		);
		expect(spawnedCommands[1]).toBe(
			`npm install -g cline@${currentVersion} --min-release-age=0`,
		);
		expect(spawnedCommands[2]).toBe(wrapperPath);
	});

	it("skips rollback when the failed update left the install intact", async () => {
		const wrapperPath = setupNpmInstall();
		const spawnedCommands: string[] = [];
		mockSpawn.mockImplementation((command: string) => {
			spawnedCommands.push(command);
			if (command.startsWith("npm update -g cline")) {
				return createChildProcessThatCloses(1);
			}
			return createChildProcessThatCloses(0);
		});

		const exitCode = await checkForUpdates({ includeKanban: false });

		expect(exitCode).toBe(1);
		expect(spawnedCommands).toEqual([
			"npm update -g cline --tag latest --min-release-age=0",
			wrapperPath,
		]);
		expect(
			spawnedCommands.some((command) =>
				command.startsWith("npm install -g cline@"),
			),
		).toBe(false);
	});

	it("rolls back when the update succeeds but the install fails its health check", async () => {
		const wrapperPath = setupNpmInstall();
		const spawnedCommands: string[] = [];
		mockSpawn.mockImplementation((command: string) => {
			spawnedCommands.push(command);
			if (command.startsWith("npm update -g cline")) {
				// npm exits 0 but leaves the install without a working wrapper.
				rmSync(wrapperPath, { force: true });
				return createChildProcessThatCloses(0);
			}
			if (command.startsWith("npm install -g cline@")) {
				createFile(wrapperPath);
				return createChildProcessThatCloses(0);
			}
			return createChildProcessThatCloses(0);
		});

		const exitCode = await checkForUpdates({ includeKanban: false });

		expect(exitCode).toBe(1);
		expect(spawnedCommands).toEqual([
			"npm update -g cline --tag latest --min-release-age=0",
			`npm install -g cline@${currentVersion} --min-release-age=0`,
			wrapperPath,
		]);
	});

	it("reports success when the update passes the post-install health check", async () => {
		const wrapperPath = setupNpmInstall();
		const spawnedCommands: string[] = [];
		mockSpawn.mockImplementation((command: string) => {
			spawnedCommands.push(command);
			return createChildProcessThatCloses(0);
		});

		const exitCode = await checkForUpdates({ includeKanban: false });

		expect(exitCode).toBe(0);
		expect(spawnedCommands).toEqual([
			"npm update -g cline --tag latest --min-release-age=0",
			wrapperPath,
		]);
	});
});

describe("withMinimumReleaseAgeBypass", () => {
	it("adds the package-manager-specific cooldown bypass", () => {
		expect(
			withMinimumReleaseAgeBypass(
				"npm update -g cline --tag latest",
				PackageManager.NPM,
			).command,
		).toBe("npm update -g cline --tag latest --min-release-age=0");
		expect(
			withMinimumReleaseAgeBypass("bun add -g cline@latest", PackageManager.BUN)
				.command,
		).toBe("bun add -g cline@latest --minimum-release-age=0");
		expect(
			withMinimumReleaseAgeBypass(
				"yarn global add cline@latest",
				PackageManager.YARN,
			).command,
		).toBe("yarn global add cline@latest");
		expect(
			withMinimumReleaseAgeBypass(
				"yarn global add cline@latest",
				PackageManager.YARN,
			).env?.YARN_NPM_MINIMAL_AGE_GATE,
		).toBe("0");

		expect(
			withMinimumReleaseAgeBypass(
				"pnpm add -g cline@latest",
				PackageManager.PNPM,
			).env?.pnpm_config_minimum_release_age,
		).toBe("0");
	});
});
