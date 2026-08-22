import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	buildClinePostHogClient: vi.fn(() => ({ kind: "posthog-client" })),
	PostHogFeatureFlagsProvider: vi.fn(function PostHogFeatureFlagsProvider(
		this: Record<string, unknown>,
		options: unknown,
	) {
		this.kind = "posthog";
		this.options = options;
	}),
	NoOpFeatureFlagsProvider: vi.fn(function NoOpFeatureFlagsProvider(
		this: Record<string, unknown>,
	) {
		this.kind = "noop";
	}),
	resolveCoreDistinctId: vi.fn(() => "machine-distinct-id"),
	poll: vi.fn(async () => {}),
	dispose: vi.fn(async () => {}),
	setContext: vi.fn(),
	getFlagPayload: vi.fn((_flag: unknown): unknown => undefined),
}));

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		// Two known flags keep the snapshot assertions meaningful even as the
		// real registry changes.
		FEATURE_FLAGS: ["ext-cline-pass", "ext-demo-flag"],
		NoOpFeatureFlagsProvider: mocks.NoOpFeatureFlagsProvider,
		resolveCoreDistinctId: mocks.resolveCoreDistinctId,
		FeatureFlagsService: class {
			options: Record<string, unknown>;
			constructor(options: Record<string, unknown>) {
				this.options = options;
			}
			poll = mocks.poll;
			dispose = mocks.dispose;
			setContext = mocks.setContext;
			getFlagPayload = mocks.getFlagPayload;
		},
	};
});

vi.mock("@cline/core/services/feature-flags/posthog", () => ({
	buildClinePostHogClient: mocks.buildClinePostHogClient,
	PostHogFeatureFlagsProvider: mocks.PostHogFeatureFlagsProvider,
}));

import {
	buildFeatureFlagsSnapshot,
	disposeDesktopFeatureFlagsService,
	getDesktopFeatureFlagsContext,
	getDesktopFeatureFlagsService,
	refreshDesktopFeatureFlags,
	resetDesktopFeatureFlagsForTesting,
	setDesktopFeatureFlagsAccountContext,
} from "./feature-flags";

const originalApiKey = process.env.TELEMETRY_SERVICE_API_KEY;
const originalIsTest = process.env.IS_TEST;

beforeEach(() => {
	vi.clearAllMocks();
	resetDesktopFeatureFlagsForTesting();
	delete process.env.IS_TEST;
	delete process.env.E2E_TEST;
});

afterEach(() => {
	if (originalApiKey === undefined) {
		delete process.env.TELEMETRY_SERVICE_API_KEY;
	} else {
		process.env.TELEMETRY_SERVICE_API_KEY = originalApiKey;
	}
	if (originalIsTest === undefined) {
		delete process.env.IS_TEST;
	} else {
		process.env.IS_TEST = originalIsTest;
	}
});

describe("getDesktopFeatureFlagsService", () => {
	it("uses PostHog when the build-time key is inlined", () => {
		process.env.TELEMETRY_SERVICE_API_KEY = "phc_key";
		getDesktopFeatureFlagsService();
		expect(mocks.PostHogFeatureFlagsProvider).toHaveBeenCalledTimes(1);
		expect(mocks.buildClinePostHogClient).toHaveBeenCalledWith("phc_key");
		expect(mocks.NoOpFeatureFlagsProvider).not.toHaveBeenCalled();
	});

	it("falls back to the no-op provider when no key was inlined", () => {
		delete process.env.TELEMETRY_SERVICE_API_KEY;
		getDesktopFeatureFlagsService();
		expect(mocks.NoOpFeatureFlagsProvider).toHaveBeenCalledTimes(1);
		expect(mocks.PostHogFeatureFlagsProvider).not.toHaveBeenCalled();
	});

	it("never calls PostHog under IS_TEST even with a key present", () => {
		process.env.TELEMETRY_SERVICE_API_KEY = "phc_key";
		process.env.IS_TEST = "true";
		getDesktopFeatureFlagsService();
		expect(mocks.NoOpFeatureFlagsProvider).toHaveBeenCalledTimes(1);
		expect(mocks.PostHogFeatureFlagsProvider).not.toHaveBeenCalled();
	});

	it("returns one shared instance so the core and the webview agree", () => {
		process.env.TELEMETRY_SERVICE_API_KEY = "phc_key";
		expect(getDesktopFeatureFlagsService()).toBe(
			getDesktopFeatureFlagsService(),
		);
		expect(mocks.PostHogFeatureFlagsProvider).toHaveBeenCalledTimes(1);
	});
});

describe("feature flags context", () => {
	it("defaults to the machine distinct ID under the cline-code client name", () => {
		const context = getDesktopFeatureFlagsContext();
		expect(context.clientName).toBe("cline-code");
		expect(context.distinctId).toBe("machine-distinct-id");
	});

	it("switches to the account ID once signed in, and pushes it to the service", () => {
		process.env.TELEMETRY_SERVICE_API_KEY = "phc_key";
		getDesktopFeatureFlagsService();
		setDesktopFeatureFlagsAccountContext({
			id: "acct-1",
			email: "dev@example.com",
		});
		const context = getDesktopFeatureFlagsContext();
		expect(context.distinctId).toBe("acct-1");
		expect(context.userId).toBe("acct-1");
		expect(mocks.setContext).toHaveBeenCalledTimes(1);
	});

	it("keeps the device identity when the account ID is blank", () => {
		setDesktopFeatureFlagsAccountContext({ id: "   " });
		expect(getDesktopFeatureFlagsContext().distinctId).toBe(
			"machine-distinct-id",
		);
	});

	it("clears the account identity on sign-out and falls back to the device", () => {
		setDesktopFeatureFlagsAccountContext({ id: "acct-1" });
		expect(getDesktopFeatureFlagsContext().userId).toBe("acct-1");

		expect(setDesktopFeatureFlagsAccountContext({})).toBe(true);

		const context = getDesktopFeatureFlagsContext();
		expect(context.userId).toBeUndefined();
		// Must not be left on the signed-out account's ID.
		expect(context.distinctId).toBe("machine-distinct-id");
	});

	it("reports no change when the same account is re-confirmed", () => {
		expect(setDesktopFeatureFlagsAccountContext({ id: "acct-1" })).toBe(true);
		expect(setDesktopFeatureFlagsAccountContext({ id: "acct-1" })).toBe(false);
	});

	it("reports no change when signed out twice", () => {
		expect(setDesktopFeatureFlagsAccountContext({})).toBe(false);
	});

	it("re-points at the new account when switching accounts", () => {
		setDesktopFeatureFlagsAccountContext({ id: "acct-1" });
		expect(setDesktopFeatureFlagsAccountContext({ id: "acct-2" })).toBe(true);

		const context = getDesktopFeatureFlagsContext();
		expect(context.userId).toBe("acct-2");
		expect(context.distinctId).toBe("acct-2");
	});
});

describe("buildFeatureFlagsSnapshot", () => {
	it("resolves every known flag so the client needs no defaults", () => {
		mocks.getFlagPayload.mockImplementation((flag: unknown) =>
			flag === "ext-cline-pass" ? true : undefined,
		);
		const snapshot = buildFeatureFlagsSnapshot(
			getDesktopFeatureFlagsService() as never,
		);
		expect(snapshot.flags).toEqual({
			"ext-cline-pass": true,
			// Unreturned flags resolve to false rather than being absent.
			"ext-demo-flag": false,
		});
	});

	it("passes non-boolean payloads through untouched", () => {
		mocks.getFlagPayload.mockImplementation((flag: unknown) =>
			flag === "ext-cline-pass" ? { variant: "b", limit: 3 } : false,
		);
		const snapshot = buildFeatureFlagsSnapshot(
			getDesktopFeatureFlagsService() as never,
		);
		expect(snapshot.flags["ext-cline-pass"]).toEqual({
			variant: "b",
			limit: 3,
		});
	});
});

describe("refreshDesktopFeatureFlags", () => {
	it("polls before returning the snapshot", async () => {
		mocks.getFlagPayload.mockReturnValue(true);
		const snapshot = await refreshDesktopFeatureFlags();
		expect(mocks.poll).toHaveBeenCalledTimes(1);
		expect(snapshot.flags["ext-cline-pass"]).toBe(true);
	});

	it("still returns cached values when the poll fails", async () => {
		mocks.poll.mockRejectedValueOnce(new Error("offline"));
		mocks.getFlagPayload.mockReturnValue(false);
		const logger = { error: vi.fn(), log: vi.fn(), debug: vi.fn() };

		const snapshot = await refreshDesktopFeatureFlags({ logger });

		expect(snapshot.flags["ext-cline-pass"]).toBe(false);
		expect(logger.error).toHaveBeenCalled();
	});
});

describe("disposeDesktopFeatureFlagsService", () => {
	it("disposes the live service and clears it", async () => {
		process.env.TELEMETRY_SERVICE_API_KEY = "phc_key";
		getDesktopFeatureFlagsService();
		await disposeDesktopFeatureFlagsService();
		expect(mocks.dispose).toHaveBeenCalledTimes(1);

		// A later call builds a fresh service rather than reusing a disposed one.
		getDesktopFeatureFlagsService();
		expect(mocks.PostHogFeatureFlagsProvider).toHaveBeenCalledTimes(2);
	});

	it("is a no-op when nothing was created", async () => {
		await expect(disposeDesktopFeatureFlagsService()).resolves.toBeUndefined();
		expect(mocks.dispose).not.toHaveBeenCalled();
	});
});
