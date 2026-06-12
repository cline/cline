import {
	type BasicLogger,
	type IFeatureFlagsProvider,
	NoOpFeatureFlagsProvider,
} from "@cline/core";
import { PostHogFeatureFlagsProvider } from "@cline/core/services/feature-flags/posthog";

const POSTHOG_FEATURE_FLAGS_HOST = "https://data.cline.bot";
const POSTHOG_FEATURE_FLAGS_TIMEOUT_MS = 5000;

export function createCliFeatureFlagsProvider(options?: {
	distinctId?: string;
	logger?: BasicLogger;
}): IFeatureFlagsProvider {
	const apiKey = process.env.TELEMETRY_SERVICE_API_KEY?.trim();
	if (
		!apiKey ||
		process.env.IS_TEST === "true" ||
		process.env.E2E_TEST === "true"
	) {
		return new NoOpFeatureFlagsProvider();
	}

	return new PostHogFeatureFlagsProvider({
		distinctId: options?.distinctId,
		config: {
			apiKey,
			host: POSTHOG_FEATURE_FLAGS_HOST,
			timeoutMs: POSTHOG_FEATURE_FLAGS_TIMEOUT_MS,
			logger: options?.logger,
		},
	});
}
