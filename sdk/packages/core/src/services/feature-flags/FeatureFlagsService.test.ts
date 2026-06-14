import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FEATURE_FLAGS, type IFeatureFlagsProvider } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagsService } from "./FeatureFlagsService";

const TEST_BOOLEAN_FLAG = "test_boolean_flag";
const TEST_PAYLOAD_FLAG = "test_payload_flag";

function createProvider(
	overrides: Partial<IFeatureFlagsProvider> = {},
): IFeatureFlagsProvider {
	return {
		getAllFlagsAndPayloads: vi.fn(async () => ({
			featureFlags: {
				[TEST_BOOLEAN_FLAG]: true,
			},
			featureFlagPayloads: {
				[TEST_PAYLOAD_FLAG]: 1234,
			},
		})),
		enabled: true,
		getSettings: vi.fn(() => ({ enabled: true, timeoutMs: 1000 })),
		dispose: vi.fn(async () => {}),
		...overrides,
	};
}

describe("FeatureFlagsService", () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it("polls provider values into the cache", async () => {
		const provider = createProvider();
		const telemetry = { capture: vi.fn() };
		const service = new FeatureFlagsService({
			provider,
			telemetry: telemetry as never,
			context: { distinctId: "machine-1", clientName: "unit-test" },
		});

		await service.poll("user-1");

		expect(provider.getAllFlagsAndPayloads).toHaveBeenCalledWith({
			flagKeys: FEATURE_FLAGS.length > 0 ? FEATURE_FLAGS : undefined,
			context: {
				distinctId: "machine-1",
				clientName: "unit-test",
				userId: "user-1",
			},
		});
		expect(service.getBooleanFlagEnabled(TEST_BOOLEAN_FLAG)).toBe(true);
		expect(service.getFlagPayload(TEST_PAYLOAD_FLAG)).toBe(1234);
		expect(telemetry.capture).toHaveBeenCalledWith({
			event: "$feature_flag_called",
			properties: {
				$feature_flag: TEST_BOOLEAN_FLAG,
				$feature_flag_response: true,
			},
		});
	});

	it("skips polling while the cache is fresh and user context is unchanged", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-10T10:00:00Z"));
		const provider = createProvider();
		const service = new FeatureFlagsService({ provider });

		await service.poll("user-1");
		expect(provider.getAllFlagsAndPayloads).toHaveBeenCalledTimes(1);

		await service.poll("user-1");

		expect(provider.getAllFlagsAndPayloads).toHaveBeenCalledTimes(1);
	});

	it("polls only once if two calls are made simultaneously with the same user context", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-10T10:00:00Z"));

		const provider = createProvider();
		const service = new FeatureFlagsService({ provider });

		await Promise.all([service.poll("user-1"), service.poll("user-1")]);

		expect(provider.getAllFlagsAndPayloads).toHaveBeenCalledTimes(1);
	});

	it("re-polls when the user context changes within the cache ttl", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-10T10:00:00Z"));
		const provider = createProvider();
		const service = new FeatureFlagsService({ provider });

		await service.poll("user-1");
		await service.poll("user-2");

		expect(provider.getAllFlagsAndPayloads).toHaveBeenCalledTimes(2);
	});

	it("returns false or undefined before polling", () => {
		const service = new FeatureFlagsService({ provider: createProvider() });

		expect(service.getBooleanFlagEnabled(TEST_BOOLEAN_FLAG)).toBe(false);
		expect(service.getFlagPayload(TEST_PAYLOAD_FLAG)).toBeUndefined();
	});

	it("hydrates from a persistent cache file before polling", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-10T10:00:00Z"));
		const cacheFilePath = join(
			mkdtempSync(join(tmpdir(), "cline-feature-flags-")),
			"feature-flags.json",
		);
		writeFileSync(
			cacheFilePath,
			`${JSON.stringify({
				version: 1,
				updatedAt: Date.now(),
				userId: "user-1",
				flagsPayload: {
					featureFlags: { [TEST_BOOLEAN_FLAG]: true },
					featureFlagPayloads: { [TEST_PAYLOAD_FLAG]: 1234 },
				},
			})}\n`,
			"utf8",
		);

		const service = new FeatureFlagsService({
			provider: createProvider(),
			cacheFilePath,
			context: { userId: "user-1" },
		});

		expect(service.getBooleanFlagEnabled(TEST_BOOLEAN_FLAG)).toBe(true);
		expect(service.getFlagPayload(TEST_PAYLOAD_FLAG)).toBe(1234);
	});

	it("writes a persistent cache file after polling", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-10T10:00:00Z"));
		const cacheFilePath = join(
			mkdtempSync(join(tmpdir(), "cline-feature-flags-")),
			"nested",
			"feature-flags.json",
		);
		const service = new FeatureFlagsService({
			provider: createProvider(),
			cacheFilePath,
		});

		await service.poll("user-1");

		const cache = JSON.parse(readFileSync(cacheFilePath, "utf8")) as {
			version: number;
			updatedAt: number;
			userId: string | null;
			flagsPayload?: {
				featureFlags?: Record<string, unknown>;
				featureFlagPayloads?: Record<string, unknown>;
			};
		};
		expect(cache).toMatchObject({
			version: 1,
			updatedAt: Date.now(),
			userId: "user-1",
			flagsPayload: {
				featureFlags: { [TEST_BOOLEAN_FLAG]: true },
				featureFlagPayloads: { [TEST_PAYLOAD_FLAG]: 1234 },
			},
		});
	});

	it("disposes the provider", async () => {
		const provider = createProvider();
		const service = new FeatureFlagsService({ provider });

		await service.dispose();

		expect(provider.dispose).toHaveBeenCalledTimes(1);
	});
});
