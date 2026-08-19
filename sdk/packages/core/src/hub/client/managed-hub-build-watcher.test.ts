import { afterEach, describe, expect, it, vi } from "vitest";

type DiscoveryMockOptions = {
	record?: Record<string, unknown>;
	probe?: Record<string, unknown> | undefined;
	expectedBuildId?: string;
};

function mockDiscovery(options: DiscoveryMockOptions): void {
	vi.doMock("../discovery/workspace", () => ({
		resolveProductionHubOwnerContext: () => ({
			ownerId: "hub-test",
			discoveryPath: "/tmp/hub-watcher-discovery.json",
		}),
		resolveSharedHubOwnerContext: () => ({
			ownerId: "hub-test",
			discoveryPath: "/tmp/hub-watcher-discovery.json",
		}),
	}));
	vi.doMock("../discovery", async () => {
		const actual =
			await vi.importActual<typeof import("../discovery")>("../discovery");
		return {
			...actual,
			resolveHubBuildId: () => options.expectedBuildId ?? "current-build",
			readHubDiscovery: vi.fn(async () => options.record),
			probeHubServer: vi.fn(async () => options.probe),
		};
	});
}

const liveRecord = {
	hubId: "hub-test",
	protocolVersion: "v1",
	buildId: "old-build",
	authToken: "token",
	host: "127.0.0.1",
	port: 59999,
	url: "ws://127.0.0.1:59999/hub",
	startedAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
};

describe("checkManagedHubBuildMismatch", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("reports a live hub running a newer build", async () => {
		vi.stubEnv("CLINE_HUB_BUILD_EPOCH_MS", "1000");
		mockDiscovery({
			record: liveRecord,
			probe: {
				protocolVersion: "v1",
				buildId: "newer-build",
				buildEpochMs: 2_000,
				coreVersion: "0.0.73",
				host: "127.0.0.1",
				port: 59999,
				url: "ws://127.0.0.1:59999/hub",
			},
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(checkManagedHubBuildMismatch()).resolves.toEqual({
			url: "ws://127.0.0.1:59999/hub",
			reason: "build_mismatch",
			hubBuildId: "newer-build",
			hubCoreVersion: "0.0.73",
			expectedBuildId: "current-build",
		});
	});

	it("reports an older hub build as outdated rather than a client update", async () => {
		vi.stubEnv("CLINE_HUB_BUILD_EPOCH_MS", "1000");
		mockDiscovery({
			record: liveRecord,
			probe: {
				protocolVersion: "v1",
				buildId: "old-build",
				buildEpochMs: 500,
				host: "127.0.0.1",
				port: 59999,
				url: "ws://127.0.0.1:59999/hub",
			},
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(checkManagedHubBuildMismatch()).resolves.toMatchObject({
			reason: "outdated_hub",
		});
	});

	// A Hub carrying no ordering metadata cannot be placed relative to this
	// build, and updating this client is what supplies the missing metadata, so
	// it stays a client-update prompt.
	it("prompts to update the client for a legacy hub without build metadata", async () => {
		mockDiscovery({
			record: liveRecord,
			probe: {
				protocolVersion: "v1",
				host: "127.0.0.1",
				port: 59999,
				url: "ws://127.0.0.1:59999/hub",
			},
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(checkManagedHubBuildMismatch()).resolves.toMatchObject({
			reason: "build_mismatch",
		});
	});

	it("prompts when the hub protocol is not supported by this client", async () => {
		mockDiscovery({
			record: liveRecord,
			probe: {
				protocolVersion: "v99",
				buildId: "future-build",
				host: "127.0.0.1",
				port: 59999,
				url: "ws://127.0.0.1:59999/hub",
			},
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(checkManagedHubBuildMismatch()).resolves.toMatchObject({
			reason: "unsupported_protocol",
		});
	});

	it("returns undefined when the hub matches this build", async () => {
		mockDiscovery({
			record: liveRecord,
			probe: {
				protocolVersion: "v1",
				buildId: "current-build",
				host: "127.0.0.1",
				port: 59999,
				url: "ws://127.0.0.1:59999/hub",
			},
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(checkManagedHubBuildMismatch()).resolves.toBeUndefined();
	});

	it("returns undefined when no discovery record exists", async () => {
		mockDiscovery({ record: undefined, probe: undefined });
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(checkManagedHubBuildMismatch()).resolves.toBeUndefined();
	});

	it("returns undefined when the recorded hub is unreachable", async () => {
		mockDiscovery({ record: liveRecord, probe: undefined });
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(checkManagedHubBuildMismatch()).resolves.toBeUndefined();
	});
});

describe("watchManagedHubBuildMismatch", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	/**
	 * An older Hub is normally retired within moments of being seen, so
	 * reporting the first sighting would flash a dialog about a Hub that is
	 * already gone. Only a Hub still there on the next check was deliberately
	 * left running.
	 */
	it("reports an outdated hub only once it survives a second check", async () => {
		vi.useFakeTimers();
		vi.stubEnv("CLINE_HUB_BUILD_EPOCH_MS", "1000");
		const probeResult: Record<string, unknown> | undefined = {
			protocolVersion: "v1",
			buildId: "old-build",
			buildEpochMs: 500,
			host: "127.0.0.1",
			port: 59999,
			url: "ws://127.0.0.1:59999/hub",
		};
		vi.doMock("../discovery/workspace", () => ({
			resolveProductionHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-watcher-discovery.json",
			}),
			resolveSharedHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-watcher-discovery.json",
			}),
		}));
		vi.doMock("../discovery", async () => {
			const actual =
				await vi.importActual<typeof import("../discovery")>("../discovery");
			return {
				...actual,
				resolveHubBuildId: () => "current-build",
				readHubDiscovery: vi.fn(async () => liveRecord),
				probeHubServer: vi.fn(async () => probeResult),
			};
		});
		const { watchManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		const onMismatch = vi.fn();
		const stop = watchManagedHubBuildMismatch({
			onMismatch,
			intervalMs: 1_000,
		});
		try {
			// First sighting is held back.
			await vi.advanceTimersByTimeAsync(1_000);
			expect(onMismatch).not.toHaveBeenCalled();

			// Still there on the next check: the Hub was left in place.
			await vi.advanceTimersByTimeAsync(1_000);
			expect(onMismatch).toHaveBeenCalledTimes(1);
			expect(onMismatch).toHaveBeenLastCalledWith(
				expect.objectContaining({ reason: "outdated_hub" }),
			);
		} finally {
			stop();
		}
	});

	it("never reports an outdated hub that is replaced right after it is seen", async () => {
		vi.useFakeTimers();
		vi.stubEnv("CLINE_HUB_BUILD_EPOCH_MS", "1000");
		let probeResult: Record<string, unknown> | undefined = {
			protocolVersion: "v1",
			buildId: "old-build",
			buildEpochMs: 500,
			host: "127.0.0.1",
			port: 59999,
			url: "ws://127.0.0.1:59999/hub",
		};
		vi.doMock("../discovery/workspace", () => ({
			resolveProductionHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-watcher-discovery.json",
			}),
			resolveSharedHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-watcher-discovery.json",
			}),
		}));
		vi.doMock("../discovery", async () => {
			const actual =
				await vi.importActual<typeof import("../discovery")>("../discovery");
			return {
				...actual,
				resolveHubBuildId: () => "current-build",
				readHubDiscovery: vi.fn(async () => liveRecord),
				probeHubServer: vi.fn(async () => probeResult),
			};
		});
		const { watchManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		const onMismatch = vi.fn();
		const stop = watchManagedHubBuildMismatch({
			onMismatch,
			intervalMs: 1_000,
		});
		try {
			await vi.advanceTimersByTimeAsync(1_000);
			// Replaced by this build before the next check.
			probeResult = {
				protocolVersion: "v1",
				buildId: "current-build",
				host: "127.0.0.1",
				port: 59999,
				url: "ws://127.0.0.1:59999/hub",
			};
			await vi.advanceTimersByTimeAsync(3_000);
			expect(onMismatch).not.toHaveBeenCalled();
		} finally {
			stop();
		}
	});

	it("fires once per mismatched hub build and re-arms after recovery", async () => {
		vi.useFakeTimers();
		vi.stubEnv("CLINE_HUB_BUILD_EPOCH_MS", "1000");
		let probeResult: Record<string, unknown> | undefined = {
			protocolVersion: "v1",
			buildId: "newer-build",
			buildEpochMs: 2_000,
			host: "127.0.0.1",
			port: 59999,
			url: "ws://127.0.0.1:59999/hub",
		};
		vi.doMock("../discovery/workspace", () => ({
			resolveProductionHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-watcher-discovery.json",
			}),
			resolveSharedHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-watcher-discovery.json",
			}),
		}));
		vi.doMock("../discovery", async () => {
			const actual =
				await vi.importActual<typeof import("../discovery")>("../discovery");
			return {
				...actual,
				resolveHubBuildId: () => "current-build",
				readHubDiscovery: vi.fn(async () => liveRecord),
				probeHubServer: vi.fn(async () => probeResult),
			};
		});
		const { watchManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		const onMismatch = vi.fn();
		const stop = watchManagedHubBuildMismatch({
			onMismatch,
			intervalMs: 1_000,
		});
		try {
			await vi.advanceTimersByTimeAsync(1_000);
			expect(onMismatch).toHaveBeenCalledTimes(1);
			expect(onMismatch).toHaveBeenLastCalledWith(
				expect.objectContaining({ hubBuildId: "newer-build" }),
			);

			// Same mismatched build: no repeat notifications.
			await vi.advanceTimersByTimeAsync(2_000);
			expect(onMismatch).toHaveBeenCalledTimes(1);

			// Hub becomes compatible, then mismatches again with a new build.
			probeResult = {
				protocolVersion: "v1",
				buildId: "current-build",
				host: "127.0.0.1",
				port: 59999,
				url: "ws://127.0.0.1:59999/hub",
			};
			await vi.advanceTimersByTimeAsync(1_000);
			expect(onMismatch).toHaveBeenCalledTimes(1);

			probeResult = {
				protocolVersion: "v1",
				buildId: "even-newer-build",
				buildEpochMs: 3_000,
				host: "127.0.0.1",
				port: 59999,
				url: "ws://127.0.0.1:59999/hub",
			};
			await vi.advanceTimersByTimeAsync(1_000);
			expect(onMismatch).toHaveBeenCalledTimes(2);
			expect(onMismatch).toHaveBeenLastCalledWith(
				expect.objectContaining({ hubBuildId: "even-newer-build" }),
			);
		} finally {
			stop();
		}
	});

	it("does not start inside hub daemon processes or with explicit endpoints", async () => {
		vi.useFakeTimers();
		mockDiscovery({
			record: liveRecord,
			probe: {
				protocolVersion: "v1",
				buildId: "old-build",
				host: "127.0.0.1",
				port: 59999,
				url: "ws://127.0.0.1:59999/hub",
			},
		});
		vi.stubEnv("CLINE_HUB_PORT", "25777");
		const { watchManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		const onMismatch = vi.fn();
		const stop = watchManagedHubBuildMismatch({
			onMismatch,
			intervalMs: 1_000,
		});
		await vi.advanceTimersByTimeAsync(5_000);
		expect(onMismatch).not.toHaveBeenCalled();
		stop();
	});
});
