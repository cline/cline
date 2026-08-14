import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	clearHubDiscovery,
	clearHubDiscoveryIfOwned,
	getManagedHubCompatibility,
	isManagedHubReusable,
	probeHubServer,
	readHubDiscovery,
	resolveHubBuildEpochMs,
	resolveHubBuildId,
	resolveHubOwnerContext,
	writeHubDiscovery,
} from ".";

type EnvSnapshot = {
	CLINE_DATA_DIR: string | undefined;
	CLINE_HUB_BUILD_ID: string | undefined;
	CLINE_HUB_BUILD_EPOCH_MS: string | undefined;
	CLINE_HUB_DISCOVERY_PATH: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
		CLINE_HUB_BUILD_ID: process.env.CLINE_HUB_BUILD_ID,
		CLINE_HUB_BUILD_EPOCH_MS: process.env.CLINE_HUB_BUILD_EPOCH_MS,
		CLINE_HUB_DISCOVERY_PATH: process.env.CLINE_HUB_DISCOVERY_PATH,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.CLINE_DATA_DIR = snapshot.CLINE_DATA_DIR;
	process.env.CLINE_HUB_BUILD_ID = snapshot.CLINE_HUB_BUILD_ID;
	process.env.CLINE_HUB_BUILD_EPOCH_MS = snapshot.CLINE_HUB_BUILD_EPOCH_MS;
	process.env.CLINE_HUB_DISCOVERY_PATH = snapshot.CLINE_HUB_DISCOVERY_PATH;
}

describe("hub discovery", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
	});

	it("stores shared hub discovery under the locks directory by default", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_HUB_DISCOVERY_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveHubOwnerContext("shared").discoveryPath).toBe(
			join(
				"/tmp/cline-data",
				"locks",
				"hub",
				"owners",
				"hub-a4d26868017c.json",
			),
		);
	});

	it("honors an explicit hub discovery path override", () => {
		snapshot = captureEnv();
		process.env.CLINE_HUB_DISCOVERY_PATH = "/tmp/custom-hub-discovery.json";

		expect(resolveHubOwnerContext("shared").discoveryPath).toBe(
			"/tmp/custom-hub-discovery.json",
		);
	});

	it("allows tests to override the unbundled source build identity", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_HUB_BUILD_ID;
		expect(resolveHubBuildId()).toMatch(/^source-/);

		process.env.CLINE_HUB_BUILD_ID = "e2e-build";
		expect(resolveHubBuildId()).toBe("e2e-build");
	});

	it("requires both protocol and build compatibility for managed Hubs", () => {
		expect(
			getManagedHubCompatibility(
				{ protocolVersion: "v1", buildId: "current-build" },
				"current-build",
			),
		).toEqual({ compatible: true });
		expect(
			getManagedHubCompatibility(
				{ protocolVersion: "v1", buildId: "old-build" },
				"current-build",
			),
		).toEqual({ compatible: false, reason: "build_mismatch" });
		expect(
			getManagedHubCompatibility({ protocolVersion: "v1" }, "current-build"),
		).toEqual({ compatible: false, reason: "missing_build" });
		expect(
			getManagedHubCompatibility(
				{ protocolVersion: "v2", buildId: "current-build" },
				"current-build",
			),
		).toEqual({ compatible: false, reason: "unsupported_protocol" });
	});

	it("allows tests to override the build epoch and treats sources as unordered", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_HUB_BUILD_EPOCH_MS;
		expect(resolveHubBuildEpochMs()).toBeUndefined();

		process.env.CLINE_HUB_BUILD_EPOCH_MS = "12345";
		expect(resolveHubBuildEpochMs()).toBe(12345);
	});

	it("retires a managed Hub only when this build is strictly newer", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_HUB_BUILD_EPOCH_MS;
		const self = {
			buildId: "current-build",
			buildEpochMs: 1_000,
			coreVersion: "0.0.70",
		};
		// Same build: reusable regardless of epoch.
		expect(
			isManagedHubReusable(
				{ protocolVersion: "v1", buildId: "current-build" },
				{ self },
			),
		).toBe(true);
		// Different build with a newer epoch: another install upgraded the Hub.
		expect(
			isManagedHubReusable(
				{
					protocolVersion: "v1",
					buildId: "other-build",
					buildEpochMs: 2_000,
				},
				{ self },
			),
		).toBe(true);
		// Different build that is older: retire and replace.
		expect(
			isManagedHubReusable(
				{ protocolVersion: "v1", buildId: "other-build", buildEpochMs: 500 },
				{ self },
			),
		).toBe(false);
		// No epoch, but an older core version still orders the two builds.
		expect(
			isManagedHubReusable(
				{
					protocolVersion: "v1",
					buildId: "other-build",
					coreVersion: "0.0.64",
				},
				{ self },
			),
		).toBe(false);
		// Different build with no ordering information at all: attach rather
		// than replace. Retiring an unordered peer is what let two installs
		// shut each other's daemon down in a loop.
		expect(
			isManagedHubReusable(
				{ protocolVersion: "v1", buildId: "other-build" },
				{ self },
			),
		).toBe(true);
		// Own epoch unknown (unbundled sources): attach, never downgrade.
		expect(
			isManagedHubReusable(
				{
					protocolVersion: "v1",
					buildId: "other-build",
					buildEpochMs: 2_000,
				},
				{ self: { buildId: "current-build" } },
			),
		).toBe(true);
		// Legacy hub without build metadata: attach and let the build-mismatch
		// watcher prompt instead of killing a daemon we cannot order.
		expect(isManagedHubReusable({ protocolVersion: "v1" }, { self })).toBe(
			true,
		);
		// Protocol mismatch is never reusable, newer or not.
		expect(
			isManagedHubReusable(
				{
					protocolVersion: "v2",
					buildId: "other-build",
					buildEpochMs: 2_000,
				},
				{ self },
			),
		).toBe(false);
	});

	it("writes and clears discovery records at the resolved location", async () => {
		snapshot = captureEnv();
		delete process.env.CLINE_HUB_DISCOVERY_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		const discoveryPath = resolveHubOwnerContext("shared").discoveryPath;
		const record = {
			hubId: "hub_123",
			protocolVersion: "v1",
			authToken: "test-token",
			host: "127.0.0.1",
			port: 25463,
			url: "ws://127.0.0.1:25463/hub",
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		await mkdir(dirname(discoveryPath), { recursive: true });
		await writeFile(discoveryPath, "{}\n", "utf8");
		await chmod(discoveryPath, 0o644);
		await writeHubDiscovery(discoveryPath, record);
		await expect(readHubDiscovery(discoveryPath)).resolves.toMatchObject(
			record,
		);
		// Windows does not support Unix file permissions; chmod is a no-op there.
		if (process.platform !== "win32") {
			expect((await stat(discoveryPath)).mode & 0o777).toBe(0o600);
		}
		await clearHubDiscovery(discoveryPath);
		await expect(readHubDiscovery(discoveryPath)).resolves.toBeUndefined();
	});

	it("rejects discovery records without an auth token", async () => {
		snapshot = captureEnv();
		delete process.env.CLINE_HUB_DISCOVERY_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		const discoveryPath = resolveHubOwnerContext("missing-auth").discoveryPath;
		await mkdir(dirname(discoveryPath), { recursive: true });
		await writeFile(
			discoveryPath,
			`${JSON.stringify({
				hubId: "hub_123",
				protocolVersion: "v1",
				host: "127.0.0.1",
				port: 25463,
				url: "ws://127.0.0.1:25463/hub",
				startedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			})}\n`,
			"utf8",
		);

		await expect(readHubDiscovery(discoveryPath)).resolves.toBeUndefined();
	});

	it("serializes generation cleanup with replacement publication", async () => {
		snapshot = captureEnv();
		delete process.env.CLINE_HUB_DISCOVERY_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";
		const discoveryPath = resolveHubOwnerContext(
			"generation-mutation-race",
		).discoveryPath;
		const baseRecord = {
			protocolVersion: "v1",
			authToken: "test-token",
			host: "127.0.0.1",
			port: 25463,
			url: "ws://127.0.0.1:25463/hub",
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		for (let index = 0; index < 10; index += 1) {
			await writeHubDiscovery(discoveryPath, {
				...baseRecord,
				hubId: "old-generation",
			});
			const publishReplacement = () =>
				writeHubDiscovery(discoveryPath, {
					...baseRecord,
					hubId: "replacement-generation",
					updatedAt: new Date().toISOString(),
				});
			const clearOld = () =>
				clearHubDiscoveryIfOwned(discoveryPath, "old-generation");
			await Promise.all(
				index % 2 === 0
					? [publishReplacement(), clearOld()]
					: [clearOld(), publishReplacement()],
			);
			expect((await readHubDiscovery(discoveryPath))?.hubId).toBe(
				"replacement-generation",
			);
		}

		await clearHubDiscovery(discoveryPath);
	});

	it("returns only public health fields for unauthenticated probes", async () => {
		const fetchMock = async () =>
			({
				ok: true,
				json: async () => ({
					ok: true,
					protocolVersion: "v1",
					minClientProtocolVersion: "v1",
					maxClientProtocolVersion: "v1",
					coreVersion: "1.0.0",
					host: "127.0.0.1",
					port: 25463,
					url: "ws://127.0.0.1:25463/hub",
				}),
			}) as Response;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as typeof fetch;
		try {
			const record = await probeHubServer("ws://127.0.0.1:25463/hub");

			expect(record).toMatchObject({
				protocolVersion: "v1",
				host: "127.0.0.1",
				port: 25463,
				url: "ws://127.0.0.1:25463/hub",
			});
			expect(record?.hubId).toBeUndefined();
			expect(record?.startedAt).toBeUndefined();
			expect(record?.updatedAt).toBeUndefined();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
