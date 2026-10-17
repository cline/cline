import { afterEach, describe, expect, it, vi } from "vitest";

type DiscoveryMockOptions = {
	record?: Record<string, unknown>;
	/** What the unauthenticated health probe reports; it never lists capabilities. */
	probe?: Record<string, unknown> | undefined;
	/**
	 * What the authenticated status probe reports, the only probe that lists
	 * the hub's capabilities; omitted means it reports the same as `probe`.
	 */
	status?: Record<string, unknown> | undefined;
	expectedBuildId?: string;
	/**
	 * What the session-activity query reports for an outdated hub; omitted
	 * means the hub cannot answer (the query throws) and the event carries no
	 * counts. Always mocked: the real query opens a socket, which never
	 * settles under this file's fake timers.
	 */
	activity?: { activeSessionCount: number; participantClientCount: number };
	/**
	 * This client's own build identity; omitted keeps the real resolution
	 * (env-driven buildId/epoch plus the actual core package version).
	 */
	selfIdentity?: {
		buildId?: string;
		buildEpochMs?: number;
		coreVersion?: string;
	};
};

function mockDiscovery(options: DiscoveryMockOptions): void {
	vi.doMock("./index", () => ({
		queryHubSessionActivity: vi.fn(async () => {
			if (!options.activity) {
				throw new Error("hub activity unavailable");
			}
			return options.activity;
		}),
	}));
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
			...(options.selfIdentity
				? { resolveHubBuildIdentity: () => options.selfIdentity }
				: {}),
			readHubDiscovery: vi.fn(async () => options.record),
			probeHubServer: vi.fn(
				async (_url: string, probeOptions?: { authToken?: string }) =>
					probeOptions?.authToken && "status" in options
						? options.status
						: options.probe,
			),
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

const sameBuildSelf = { buildId: "current-build", coreVersion: "0.0.93" };

const sameBuildHub = {
	protocolVersion: "v1",
	buildId: "current-build",
	coreVersion: "0.0.93",
	host: "127.0.0.1",
	port: 59999,
	url: "ws://127.0.0.1:59999/hub",
};

describe("checkManagedHubBuildMismatch", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	// Two artifacts of the same release cut from different commits never share
	// a build fingerprint or epoch (e.g. desktop-v0.0.22 and cli-v3.0.61 both
	// bundling core 0.0.82). Neither side can act on that - "update" installs
	// nothing newer - so neither direction may prompt.
	it("does not prompt for a same-release hub with a different fingerprint (hub built earlier)", async () => {
		mockDiscovery({
			expectedBuildId: "desktop-fingerprint",
			selfIdentity: {
				buildId: "desktop-fingerprint",
				buildEpochMs: 2_000,
				coreVersion: "0.0.82",
			},
			record: liveRecord,
			probe: {
				protocolVersion: "v1",
				buildId: "cli-fingerprint",
				buildEpochMs: 1_000,
				coreVersion: "0.0.82",
				host: "127.0.0.1",
				port: 59999,
				url: "ws://127.0.0.1:59999/hub",
			},
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		// Without the same-release rule this would classify as outdated_hub.
		await expect(checkManagedHubBuildMismatch()).resolves.toBeUndefined();
	});

	it("does not prompt for a same-release hub with a different fingerprint (hub built later)", async () => {
		mockDiscovery({
			expectedBuildId: "desktop-fingerprint",
			selfIdentity: {
				buildId: "desktop-fingerprint",
				buildEpochMs: 1_000,
				coreVersion: "0.0.82",
			},
			record: liveRecord,
			probe: {
				protocolVersion: "v1",
				buildId: "cli-fingerprint",
				buildEpochMs: 2_000,
				coreVersion: "0.0.82",
				host: "127.0.0.1",
				port: 59999,
				url: "ws://127.0.0.1:59999/hub",
			},
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		// Without the same-release rule this would classify as build_mismatch.
		await expect(checkManagedHubBuildMismatch()).resolves.toBeUndefined();
	});

	it("still prompts across genuinely different releases", async () => {
		mockDiscovery({
			expectedBuildId: "desktop-fingerprint",
			selfIdentity: {
				buildId: "desktop-fingerprint",
				buildEpochMs: 1_000,
				coreVersion: "0.0.82",
			},
			record: liveRecord,
			probe: {
				protocolVersion: "v1",
				buildId: "cli-fingerprint",
				buildEpochMs: 2_000,
				coreVersion: "0.0.83",
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
			hubCoreVersion: "0.0.83",
		});
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
			activity: { activeSessionCount: 2, participantClientCount: 1 },
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(checkManagedHubBuildMismatch()).resolves.toMatchObject({
			reason: "outdated_hub",
			activeSessionCount: 2,
			participantClientCount: 1,
		});
	});

	it("reports an outdated hub without counts when it cannot answer the activity query", async () => {
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

		const mismatch = await checkManagedHubBuildMismatch();
		expect(mismatch).toMatchObject({ reason: "outdated_hub" });
		expect(mismatch?.activeSessionCount).toBeUndefined();
		expect(mismatch?.participantClientCount).toBeUndefined();
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

// Every build of one release can report the same hub identity, so a client
// that serves a newer capability can land on an older hub of its own release
// that the build tiers treat as current.
describe("checkManagedHubBuildMismatch with required capabilities", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("reports a same-build hub that lacks a required capability", async () => {
		mockDiscovery({
			selfIdentity: sameBuildSelf,
			record: liveRecord,
			probe: sameBuildHub,
			status: { ...sameBuildHub, capabilities: ["session.create"] },
			activity: { activeSessionCount: 1, participantClientCount: 2 },
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(
			checkManagedHubBuildMismatch({ requiredCapabilities: ["plugins.ui"] }),
		).resolves.toEqual({
			url: "ws://127.0.0.1:59999/hub",
			reason: "missing_capability",
			hubBuildId: "current-build",
			hubCoreVersion: "0.0.93",
			expectedBuildId: "current-build",
			missingCapabilities: ["plugins.ui"],
			activeSessionCount: 1,
			participantClientCount: 2,
		});
	});

	it("reads capabilities from the authenticated status probe", async () => {
		mockDiscovery({
			selfIdentity: sameBuildSelf,
			record: liveRecord,
			probe: sameBuildHub,
			status: { ...sameBuildHub, capabilities: ["plugins.ui"] },
		});
		const discovery = await import("../discovery");
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(
			checkManagedHubBuildMismatch({ requiredCapabilities: ["plugins.ui"] }),
		).resolves.toBeUndefined();
		expect(discovery.probeHubServer).toHaveBeenCalledWith(
			"ws://127.0.0.1:59999/hub",
			{ authToken: "token" },
		);
	});

	it("reports a same-release hub of an older fingerprint that lacks a required capability", async () => {
		const olderFingerprintHub = {
			protocolVersion: "v1",
			buildId: "cli-fingerprint",
			buildEpochMs: 1_000,
			coreVersion: "0.0.82",
			host: "127.0.0.1",
			port: 59999,
			url: "ws://127.0.0.1:59999/hub",
		};
		mockDiscovery({
			expectedBuildId: "desktop-fingerprint",
			selfIdentity: {
				buildId: "desktop-fingerprint",
				buildEpochMs: 2_000,
				coreVersion: "0.0.82",
			},
			record: liveRecord,
			probe: olderFingerprintHub,
			status: { ...olderFingerprintHub, capabilities: ["session.create"] },
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(
			checkManagedHubBuildMismatch({ requiredCapabilities: ["plugins.ui"] }),
		).resolves.toMatchObject({
			reason: "missing_capability",
			hubBuildId: "cli-fingerprint",
			missingCapabilities: ["plugins.ui"],
		});
	});

	it("counts a hub that lists no capabilities as lacking them", async () => {
		mockDiscovery({
			selfIdentity: sameBuildSelf,
			record: liveRecord,
			probe: sameBuildHub,
			status: sameBuildHub,
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(
			checkManagedHubBuildMismatch({
				requiredCapabilities: ["plugins.ui", "plugins.status"],
			}),
		).resolves.toMatchObject({
			reason: "missing_capability",
			missingCapabilities: ["plugins.ui", "plugins.status"],
		});
	});

	it("stays silent when no capability is required", async () => {
		mockDiscovery({
			selfIdentity: sameBuildSelf,
			record: liveRecord,
			probe: sameBuildHub,
			status: { ...sameBuildHub, capabilities: ["session.create"] },
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(checkManagedHubBuildMismatch()).resolves.toBeUndefined();
	});

	it("stays silent when the hub has every required capability", async () => {
		mockDiscovery({
			selfIdentity: sameBuildSelf,
			record: liveRecord,
			probe: sameBuildHub,
			status: {
				...sameBuildHub,
				capabilities: ["session.create", "plugins.ui"],
			},
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(
			checkManagedHubBuildMismatch({ requiredCapabilities: ["plugins.ui"] }),
		).resolves.toBeUndefined();
	});

	it("stays silent when the hub does not answer the authenticated status probe", async () => {
		mockDiscovery({
			selfIdentity: sameBuildSelf,
			record: liveRecord,
			probe: sameBuildHub,
			status: undefined,
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(
			checkManagedHubBuildMismatch({ requiredCapabilities: ["plugins.ui"] }),
		).resolves.toBeUndefined();
	});

	// Replacing a newer hub would downgrade another install's daemon; updating
	// this client is the fix there, not a restart.
	it("never reports a newer hub of the same release", async () => {
		const newerFingerprintHub = {
			protocolVersion: "v1",
			buildId: "cli-fingerprint",
			buildEpochMs: 2_000,
			coreVersion: "0.0.82",
			host: "127.0.0.1",
			port: 59999,
			url: "ws://127.0.0.1:59999/hub",
		};
		mockDiscovery({
			expectedBuildId: "desktop-fingerprint",
			selfIdentity: {
				buildId: "desktop-fingerprint",
				buildEpochMs: 1_000,
				coreVersion: "0.0.82",
			},
			record: liveRecord,
			probe: newerFingerprintHub,
			status: { ...newerFingerprintHub, capabilities: ["session.create"] },
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		await expect(
			checkManagedHubBuildMismatch({ requiredCapabilities: ["plugins.ui"] }),
		).resolves.toBeUndefined();
	});

	it.each([
		{
			reason: "build_mismatch",
			hub: {
				buildId: "newer-build",
				buildEpochMs: 2_000,
				coreVersion: "0.0.94",
			},
		},
		{
			reason: "outdated_hub",
			hub: { buildId: "old-build", buildEpochMs: 500, coreVersion: "0.0.92" },
		},
		{
			reason: "unsupported_protocol",
			hub: { protocolVersion: "v99", buildId: "future-build" },
		},
	])("keeps reporting $reason when a capability is also missing", async ({
		reason,
		hub,
	}) => {
		const probe = {
			protocolVersion: "v1",
			host: "127.0.0.1",
			port: 59999,
			url: "ws://127.0.0.1:59999/hub",
			...hub,
		};
		mockDiscovery({
			selfIdentity: {
				buildId: "current-build",
				buildEpochMs: 1_000,
				coreVersion: "0.0.93",
			},
			record: liveRecord,
			probe,
			status: { ...probe, capabilities: ["session.create"] },
		});
		const { checkManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		const mismatch = await checkManagedHubBuildMismatch({
			requiredCapabilities: ["plugins.ui"],
		});
		expect(mismatch).toMatchObject({ reason });
		expect(mismatch?.missingCapabilities).toBeUndefined();
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
		const onResolved = vi.fn();
		const stop = watchManagedHubBuildMismatch({
			onMismatch,
			onResolved,
			intervalMs: 1_000,
		});
		try {
			await vi.advanceTimersByTimeAsync(1_000);
			expect(onResolved).not.toHaveBeenCalled();
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
			expect(onResolved).toHaveBeenCalledTimes(1);
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

	// Nothing replaces a hub for a missing capability automatically, so there is
	// no replacement to wait out before telling the user.
	it("reports a hub lacking a required capability on its first sighting, once", async () => {
		vi.useFakeTimers();
		mockDiscovery({
			selfIdentity: sameBuildSelf,
			record: liveRecord,
			probe: sameBuildHub,
			status: { ...sameBuildHub, capabilities: ["session.create"] },
		});
		const { watchManagedHubBuildMismatch } = await import(
			"./managed-hub-build-watcher"
		);

		const onMismatch = vi.fn();
		const stop = watchManagedHubBuildMismatch({
			onMismatch,
			intervalMs: 1_000,
			requiredCapabilities: ["plugins.ui"],
		});
		try {
			await vi.advanceTimersByTimeAsync(1_000);
			expect(onMismatch).toHaveBeenCalledTimes(1);
			expect(onMismatch).toHaveBeenLastCalledWith(
				expect.objectContaining({
					reason: "missing_capability",
					missingCapabilities: ["plugins.ui"],
				}),
			);

			await vi.advanceTimersByTimeAsync(3_000);
			expect(onMismatch).toHaveBeenCalledTimes(1);
		} finally {
			stop();
		}
	});

	describe("reporting a resolved mismatch", () => {
		const lackingPluginUi = {
			...sameBuildHub,
			capabilities: ["session.create"],
		};
		const servingPluginUi = {
			...sameBuildHub,
			capabilities: ["session.create", "plugins.ui"],
		};

		async function watchHub(hub: DiscoveryMockOptions) {
			vi.useFakeTimers();
			mockDiscovery(hub);
			const { watchManagedHubBuildMismatch } = await import(
				"./managed-hub-build-watcher"
			);
			const onMismatch = vi.fn();
			const onResolved = vi.fn();
			const stop = watchManagedHubBuildMismatch({
				onMismatch,
				onResolved,
				intervalMs: 1_000,
				requiredCapabilities: ["plugins.ui"],
			});
			return { onMismatch, onResolved, stop };
		}

		it("reports once that a Hub now serves a missing capability", async () => {
			const hub: DiscoveryMockOptions = {
				selfIdentity: sameBuildSelf,
				record: liveRecord,
				probe: sameBuildHub,
				status: lackingPluginUi,
			};
			const { onMismatch, onResolved, stop } = await watchHub(hub);
			try {
				await vi.advanceTimersByTimeAsync(1_000);
				expect(onMismatch).toHaveBeenCalledTimes(1);
				expect(onResolved).not.toHaveBeenCalled();

				hub.status = servingPluginUi;
				await vi.advanceTimersByTimeAsync(1_000);
				expect(onResolved).toHaveBeenCalledTimes(1);

				await vi.advanceTimersByTimeAsync(3_000);
				expect(onResolved).toHaveBeenCalledTimes(1);
				expect(onMismatch).toHaveBeenCalledTimes(1);
			} finally {
				stop();
			}
		});

		it("does not report a resolution the check could not confirm", async () => {
			const hub: DiscoveryMockOptions = {
				selfIdentity: sameBuildSelf,
				record: liveRecord,
				probe: sameBuildHub,
				status: lackingPluginUi,
			};
			const { onMismatch, onResolved, stop } = await watchHub(hub);
			try {
				await vi.advanceTimersByTimeAsync(1_000);
				expect(onMismatch).toHaveBeenCalledTimes(1);

				hub.status = undefined;
				await vi.advanceTimersByTimeAsync(2_000);
				hub.status = servingPluginUi;
				hub.record = undefined;
				await vi.advanceTimersByTimeAsync(2_000);
				hub.record = liveRecord;
				hub.probe = undefined;
				await vi.advanceTimersByTimeAsync(2_000);
				expect(onResolved).not.toHaveBeenCalled();

				hub.probe = sameBuildHub;
				await vi.advanceTimersByTimeAsync(1_000);
				expect(onResolved).toHaveBeenCalledTimes(1);
			} finally {
				stop();
			}
		});

		it("reports each resolution after a mismatch returns", async () => {
			const hub: DiscoveryMockOptions = {
				selfIdentity: sameBuildSelf,
				record: liveRecord,
				probe: sameBuildHub,
				status: lackingPluginUi,
			};
			const { onMismatch, onResolved, stop } = await watchHub(hub);
			try {
				await vi.advanceTimersByTimeAsync(1_000);
				hub.status = servingPluginUi;
				await vi.advanceTimersByTimeAsync(1_000);
				hub.status = lackingPluginUi;
				await vi.advanceTimersByTimeAsync(1_000);
				expect(onMismatch).toHaveBeenCalledTimes(2);
				expect(onResolved).toHaveBeenCalledTimes(1);

				hub.status = servingPluginUi;
				await vi.advanceTimersByTimeAsync(1_000);
				expect(onResolved).toHaveBeenCalledTimes(2);
			} finally {
				stop();
			}
		});

		// The caller can record a mismatch from its own one-off check before
		// the watcher's first tick, so the first confirmed match reports too.
		it("reports the first confirmed match even without a mismatch of its own", async () => {
			const { onMismatch, onResolved, stop } = await watchHub({
				selfIdentity: sameBuildSelf,
				record: liveRecord,
				probe: sameBuildHub,
				status: servingPluginUi,
			});
			try {
				await vi.advanceTimersByTimeAsync(3_000);
				expect(onResolved).toHaveBeenCalledTimes(1);
				expect(onMismatch).not.toHaveBeenCalled();
			} finally {
				stop();
			}
		});
	});

	it("ignores missing capabilities the watcher was not asked to require", async () => {
		vi.useFakeTimers();
		mockDiscovery({
			selfIdentity: sameBuildSelf,
			record: liveRecord,
			probe: sameBuildHub,
			status: { ...sameBuildHub, capabilities: ["session.create"] },
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
			await vi.advanceTimersByTimeAsync(3_000);
			expect(onMismatch).not.toHaveBeenCalled();
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
