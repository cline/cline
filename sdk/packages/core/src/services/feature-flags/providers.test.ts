import type { PostHog } from "posthog-node";
import { describe, expect, it, vi } from "vitest";
import { PostHogFeatureFlagsProvider } from "./posthog";

function createPostHogClient(overrides: Partial<PostHog> = {}): PostHog {
	return {
		getAllFlagsAndPayloads: vi.fn(async () => ({
			featureFlags: { flag_a: true },
			featureFlagPayloads: { flag_b: { enabled: true } },
		})),
		shutdown: vi.fn(async () => {}),
		...overrides,
	} as unknown as PostHog;
}

describe("PostHogFeatureFlagsProvider", () => {
	it("fetches all flags and payloads using the context distinct ID", async () => {
		const client = createPostHogClient();
		const provider = new PostHogFeatureFlagsProvider({
			client,
			config: { apiKey: "test-key" },
		});

		const result = await provider.getAllFlagsAndPayloads({
			flagKeys: ["flag_a", "flag_b"],
			context: { distinctId: "machine-1", userId: "user-1" },
		});

		expect(client.getAllFlagsAndPayloads).toHaveBeenCalledWith("machine-1", {
			flagKeys: ["flag_a", "flag_b"],
		});
		expect(result).toEqual({
			featureFlags: { flag_a: true },
			featureFlagPayloads: { flag_b: { enabled: true } },
		});
	});

	it("falls back to user ID and returns an empty payload on provider errors", async () => {
		const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn() };
		const client = createPostHogClient({
			getAllFlagsAndPayloads: vi.fn(async () => {
				throw new Error("network failed");
			}) as never,
		});
		const provider = new PostHogFeatureFlagsProvider({
			client,
			config: { apiKey: "test-key", logger },
		});

		const result = await provider.getAllFlagsAndPayloads({
			context: { userId: "user-1" },
		});

		expect(client.getAllFlagsAndPayloads).toHaveBeenCalledWith("user-1", {
			flagKeys: undefined,
		});
		expect(result).toEqual({});
		expect(logger.error).toHaveBeenCalledWith(
			"Error getting PostHog feature flags",
			expect.any(Object),
		);
	});

	it("does not shut down an injected shared client", async () => {
		const client = createPostHogClient();
		const provider = new PostHogFeatureFlagsProvider({
			client,
			config: { apiKey: "test-key" },
		});

		await provider.dispose();

		expect(client.shutdown).not.toHaveBeenCalled();
	});
});
