import { isClineProvider } from "@cline/shared";
import type { ClineCoreStartInput } from "./types";

/**
 * Route Cline and ClinePass AI SDK spans through the host's managed OTLP
 * exporter. This function only carries an enablement bit; Langfuse exporter
 * credentials stay on the collector and never enter session configuration.
 */
export function enableManagedClineLangfuseTelemetry(
	input: ClineCoreStartInput,
	enabled: boolean,
): ClineCoreStartInput {
	if (!enabled) {
		return input;
	}

	const config = input.config;
	const rootProviderConfig = isClineProvider(config.providerId)
		? {
				...(config.providerConfig?.providerId === config.providerId
					? config.providerConfig
					: {
							providerId: config.providerId,
							modelId: config.modelId,
						}),
				managedTelemetry: {
					...(config.providerConfig?.managedTelemetry ?? {}),
					langfuse: true,
				},
			}
		: config.providerConfig;

	const summarizer = config.compaction?.summarizer;
	const summarizerProviderConfig = summarizer?.providerConfig;
	const nextSummarizer =
		summarizer && isClineProvider(summarizer.providerId)
			? {
					...summarizer,
					providerConfig: {
						...(summarizerProviderConfig?.providerId === summarizer.providerId
							? summarizerProviderConfig
							: {
									providerId: summarizer.providerId,
									modelId: summarizer.modelId,
								}),
						managedTelemetry: {
							...(summarizerProviderConfig?.managedTelemetry ?? {}),
							langfuse: true,
						},
					},
				}
			: summarizer;

	if (
		rootProviderConfig === config.providerConfig &&
		nextSummarizer === summarizer
	) {
		return input;
	}

	return {
		...input,
		config: {
			...config,
			...(rootProviderConfig ? { providerConfig: rootProviderConfig } : {}),
			...(nextSummarizer
				? {
						compaction: {
							...config.compaction,
							summarizer: nextSummarizer,
						},
					}
				: {}),
		},
	};
}
