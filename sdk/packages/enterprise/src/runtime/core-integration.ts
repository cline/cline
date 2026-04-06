import {
	createConfiguredTelemetryService,
	type StartSessionInput,
} from "@clinebot/core";
import {
	createClineTelemetryServiceConfig,
	type ITelemetryService,
	type OpenTelemetryClientConfig,
} from "@clinebot/shared";
import type {
	PreparedEnterpriseCoreIntegration,
	PreparedEnterpriseRuntime,
	PrepareEnterpriseCoreIntegrationOptions,
} from "../contracts";
import { prepareEnterpriseRuntime } from "./prepare";

function createTelemetryService(
	prepared: PreparedEnterpriseRuntime,
	options: PrepareEnterpriseCoreIntegrationOptions,
): ITelemetryService | undefined {
	const telemetryConfig: Partial<OpenTelemetryClientConfig> | undefined =
		prepared.telemetry || options.telemetryService
			? {
					...(options.telemetryService ?? {}),
					...(prepared.telemetry ?? {}),
				}
			: undefined;

	if (!telemetryConfig) {
		return undefined;
	}

	return createConfiguredTelemetryService(
		createClineTelemetryServiceConfig(telemetryConfig),
	).telemetry;
}

export async function prepareEnterpriseCoreIntegration(
	options: PrepareEnterpriseCoreIntegrationOptions,
): Promise<PreparedEnterpriseCoreIntegration> {
	const prepared = await prepareEnterpriseRuntime(options);
	const telemetry = createTelemetryService(prepared, options);
	const extensions = [prepared.pluginDefinition];

	return {
		prepared,
		extensions,
		telemetry,
		applyToStartSessionInput(input: StartSessionInput): StartSessionInput {
			const existingExtensions = input.config.extensions ?? [];
			return {
				...input,
				config: {
					...input.config,
					extensions: [...existingExtensions, ...extensions],
					telemetry: telemetry ?? input.config.telemetry,
				},
			};
		},
		async dispose(): Promise<void> {},
	};
}
