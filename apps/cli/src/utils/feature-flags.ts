import {
	type BasicLogger,
	type FeatureFlagsContext,
	FeatureFlagsService,
	type ITelemetryService,
	NoOpFeatureFlagsProvider,
	registerDisposable,
	resolveCoreDistinctId,
} from "@cline/core";
import {
	buildClinePostHogClient,
	PostHogFeatureFlagsProvider,
} from "@cline/core/services/feature-flags/posthog";

let cliFeatureFlagsContext: FeatureFlagsContext = { clientName: "cline-cli" };
let cliFeatureFlagsService: FeatureFlagsService | undefined;

function ensureCliDistinctId(): string {
	const distinctId = cliFeatureFlagsContext.distinctId?.trim();
	if (distinctId) {
		return distinctId;
	}
	const resolved = resolveCoreDistinctId();
	cliFeatureFlagsContext.distinctId = resolved;
	return resolved;
}

export function getCliFeatureFlagsContext(): FeatureFlagsContext {
	ensureCliDistinctId();
	return { ...cliFeatureFlagsContext };
}

export function getCliFeatureFlagsService(options?: {
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
}): FeatureFlagsService {
	if (!cliFeatureFlagsService) {
		const apiKey = process.env.TELEMETRY_SERVICE_API_KEY;
		const provider =
			apiKey &&
			process.env.IS_TEST !== "true" &&
			process.env.E2E_TEST !== "true"
				? new PostHogFeatureFlagsProvider({
						client: buildClinePostHogClient(apiKey),
						config: {
							logger: options?.logger,
						},
					})
				: new NoOpFeatureFlagsProvider();

		cliFeatureFlagsService = new FeatureFlagsService({
			provider,
			telemetry: options?.telemetry,
			logger: options?.logger,
			context: getCliFeatureFlagsContext(),
		});
		registerDisposable(disposeCliFeatureFlagsService);
	}

	return cliFeatureFlagsService;
}

export async function disposeCliFeatureFlagsService(): Promise<void> {
	if (!cliFeatureFlagsService) {
		return;
	}

	const current = cliFeatureFlagsService;
	cliFeatureFlagsService = undefined;
	await current.dispose();
}

export async function identifyFeatureFlagsAccount(
	account: { id?: string; email?: string },
	logger?: BasicLogger,
): Promise<void> {
	const accountId = account.id?.trim();
	cliFeatureFlagsContext = {
		...cliFeatureFlagsContext,
		...(accountId ? { distinctId: accountId, userId: accountId } : {}),
		...(account.email?.trim() ? { email: account.email.trim() } : {}),
	};

	if (!cliFeatureFlagsService) {
		return;
	}

	cliFeatureFlagsService.setContext(getCliFeatureFlagsContext());
	try {
		await cliFeatureFlagsService.poll();
	} catch (error) {
		logger?.error?.("Error polling CLI feature flags", { error });
	}
}
