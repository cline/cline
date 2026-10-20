import { mock } from "bun:test";
import {
	buildClinePostHogClient,
	PostHogFeatureFlagsProvider,
} from "@cline/core/services/feature-flags/posthog";

// Loaded only by terminal tests. Keep the real PostHog client/provider, routing
// their HTTP requests to the test server without a production rollout bypass.
const createClient = buildClinePostHogClient;
mock.module("@cline/core/services/feature-flags/posthog", () => ({
	PostHogFeatureFlagsProvider,
	buildClinePostHogClient: (key: string) =>
		createClient(key, { host: process.env.CLINE_TEST_POSTHOG_URL }),
}));
