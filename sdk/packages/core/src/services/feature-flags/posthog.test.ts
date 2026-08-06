import { describe, expect, it, vi } from "vitest";
import { PostHogFeatureFlagsProvider } from "./posthog";

describe("PostHogFeatureFlagsProvider", () => {
	it("propagates lookup failures so the service can retain its cache", async () => {
		const error = new Error("network unavailable");
		const logger = { error: vi.fn() };
		const provider = new PostHogFeatureFlagsProvider({
			client: {
				getAllFlagsAndPayloads: vi.fn().mockRejectedValue(error),
				shutdown: vi.fn(),
			} as never,
			config: { logger },
		});

		await expect(
			provider.getAllFlagsAndPayloads({
				context: { distinctId: "user-1" },
			}),
		).rejects.toBe(error);
		expect(logger.error).toHaveBeenCalledWith(
			"Error getting PostHog feature flags",
			{ error },
		);
	});
});
