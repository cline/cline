import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSpawn } = vi.hoisted(() => ({
	mockSpawn: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: mockSpawn,
	};
});

import {
	applyDeferredUpdate,
	autoUpdateOnStartup,
	checkForUpdates,
	getInstallationInfo,
	PackageManager,
	resolveCliHubOwnerContext,
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

describe("deferred auto update", () => {
	afterEach(() => {
		mockSpawn.mockReset();
		if (originalBuildEnv === undefined) {
			delete process.env.CLINE_BUILD_ENV;
		} else {
			process.env.CLINE_BUILD_ENV = originalBuildEnv;
		}
		if (originalHubDiscoveryPath === undefined) {
			delete process.env.CLINE_HUB_DISCOVERY_PATH;
		} else {
			process.env.CLINE_HUB_DISCOVERY_PATH = originalHubDiscoveryPath;
		}
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does nothing when no update was recorded", async () => {
		expect(await applyDeferredUpdate(undefined)).toBe("none");
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("starts the detached install when no hub is discoverable", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-update-test-"));
		tempDirs.push(root);
		process.env.CLINE_BUILD_ENV = "production";
		process.env.CLINE_HUB_DISCOVERY_PATH = join(root, "production.json");
		const unref = vi.fn();
		mockSpawn.mockReturnValue({ unref } as unknown as ChildProcess);

		const outcome = await applyDeferredUpdate({
			command: "npm update -g cline --tag latest --min-release-age=0",
		});

		expect(outcome).toBe("started");
		expect(mockSpawn).toHaveBeenCalledWith(
			"npm update -g cline --tag latest --min-release-age=0",
			expect.objectContaining({
				detached: true,
				shell: true,
				stdio: "ignore",
			}),
		);
		expect(unref).toHaveBeenCalled();
	});

	it("defers while another cli client is attached to the hub", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-update-test-"));
		tempDirs.push(root);
		const discoveryPath = join(root, "production.json");
		process.env.CLINE_BUILD_ENV = "production";
		process.env.CLINE_HUB_DISCOVERY_PATH = discoveryPath;
		const {
			createLocalHubScheduleRuntimeHandlers,
			NodeHubClient,
			startHubWebSocketServer,
		} = await import("@cline/core");
		const server = await startHubWebSocketServer({
			host: "127.0.0.1",
			port: 0,
			owner: { ownerId: "update-test", discoveryPath },
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		const cliClient = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientType: "cli",
			displayName: "fake attached cli",
		});
		try {
			await cliClient.command("client.list", {});

			expect(await applyDeferredUpdate({ command: "echo update" })).toBe(
				"deferred",
			);
			expect(mockSpawn).not.toHaveBeenCalled();

			await cliClient.dispose();
			const unref = vi.fn();
			mockSpawn.mockReturnValue({ unref } as unknown as ChildProcess);
			// The hub unregisters the client when its socket closes; poll
			// briefly rather than assuming the close is processed instantly.
			let outcome = "deferred";
			const deadline = Date.now() + 3_000;
			while (outcome === "deferred" && Date.now() < deadline) {
				outcome = await applyDeferredUpdate({ command: "echo update" });
			}
			expect(outcome).toBe("started");
		} finally {
			await cliClient.dispose().catch(() => undefined);
			await server.close();
		}
	}, 15_000);
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
