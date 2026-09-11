import type { FeatureFlag, FeatureFlagsContext } from "@cline/shared";
import { ProviderSettingsManager } from "../storage/provider-settings-manager";
import { FeatureFlagsService } from "./FeatureFlagsService";
import {
	buildClinePostHogClient,
	PostHogFeatureFlagsProvider,
} from "./posthog";

// Shared by connector management and tool execution, including detached hub
// processes where a client's in-memory feature flag service is unavailable.
// Never persist these grants: startup and account changes must fail closed.
let current:
	| {
			accountId: string;
			apiKey: string;
			service: FeatureFlagsService;
			pending?: Promise<void>;
	  }
	| undefined;

function getAccountId(): string | undefined {
	return (
		new ProviderSettingsManager()
			.getProviderSettings("cline")
			?.auth?.accountId?.trim() || undefined
	);
}

/** Evaluate a boolean rollout flag for the persisted Cline account in any host.
 * Grants are cached for one minute; only an explicit boolean flag enables access.
 */
export async function isClineAccountFeatureEnabled(
	flag: FeatureFlag,
): Promise<boolean> {
	const accountId = getAccountId();
	const apiKey = process.env.TELEMETRY_SERVICE_API_KEY;
	if (!accountId || !apiKey) {
		current = undefined;
		return false;
	}
	if (current?.accountId !== accountId || current.apiKey !== apiKey) {
		current = {
			accountId,
			apiKey,
			service: new FeatureFlagsService({
				context: { distinctId: accountId, userId: accountId },
				cacheTtlMs: 60_000,
				provider: {
					enabled: true,
					getSettings: () => ({ enabled: true }),
					dispose: async () => {},
					async getAllFlagsAndPayloads(options: {
						flagKeys?: readonly string[];
						context: FeatureFlagsContext;
					}) {
						// Scope the network client to the poll so account changes and
						// idle runtimes do not leave background client handles behind.
						const provider = new PostHogFeatureFlagsProvider({
							client: buildClinePostHogClient(apiKey),
							config: {},
						});
						try {
							return await provider.getAllFlagsAndPayloads(options);
						} finally {
							await provider.dispose();
						}
					},
				},
			}),
		};
	}
	const evaluation = current;
	try {
		evaluation.pending ??= evaluation.service.poll().finally(() => {
			evaluation.pending = undefined;
		});
		await evaluation.pending;
		return (
			current === evaluation &&
			getAccountId() === accountId &&
			evaluation.service.getCacheSnapshot().flagsPayload?.featureFlags?.[
				flag
			] === true
		);
	} catch {
		return false;
	}
}
