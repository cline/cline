import {
	createConfiguredTelemetryService,
	type StartSessionInput,
} from "@clinebot/core";
import {
	createClineTelemetryServiceConfig,
	createSessionId,
	type ITelemetryService,
	type OpenTelemetryClientConfig,
} from "@clinebot/shared";
import type {
	PreparedEnterpriseCoreIntegration,
	PreparedEnterpriseRuntime,
	PrepareEnterpriseCoreIntegrationOptions,
} from "../contracts";
import {
	buildEnterpriseSessionBlobUploadMetadata,
	clearEnterpriseSessionBlobUpload,
	ENTERPRISE_SESSION_BLOB_UPLOAD_METADATA_KEY,
	registerEnterpriseSessionBlobUpload,
} from "../storage";
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
	const userDistinctId =
		prepared.claims?.subject ?? prepared.identity?.claims?.subject;
	const blobUploadMetadataTemplate = buildEnterpriseSessionBlobUploadMetadata(
		prepared.bundle?.remoteConfig,
		userDistinctId,
	);
	let registeredSessionId: string | undefined;

	return {
		prepared,
		extensions,
		telemetry,
		applyToStartSessionInput(input: StartSessionInput): StartSessionInput {
			const existingExtensions = input.config.extensions ?? [];
			const sessionId = blobUploadMetadataTemplate
				? input.config.sessionId?.trim() || createSessionId()
				: input.config.sessionId;
			if (sessionId && blobUploadMetadataTemplate) {
				registeredSessionId = sessionId;
			}
			const blobUploadMetadata =
				sessionId && blobUploadMetadataTemplate
					? registerEnterpriseSessionBlobUpload(
							sessionId,
							prepared.bundle?.remoteConfig,
							userDistinctId,
						)
					: undefined;
			const sessionMetadata = blobUploadMetadata
				? {
						...(input.sessionMetadata ?? {}),
						[ENTERPRISE_SESSION_BLOB_UPLOAD_METADATA_KEY]: blobUploadMetadata,
					}
				: input.sessionMetadata;
			return {
				...input,
				...(sessionMetadata ? { sessionMetadata } : {}),
				config: {
					...input.config,
					...(sessionId ? { sessionId } : {}),
					extensions: [...existingExtensions, ...extensions],
					telemetry: telemetry ?? input.config.telemetry,
				},
			};
		},
		async dispose(): Promise<void> {
			if (registeredSessionId) {
				clearEnterpriseSessionBlobUpload(registeredSessionId);
			}
		},
	};
}
