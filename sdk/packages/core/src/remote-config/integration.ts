import {
	type AgentExtension,
	buildRemoteConfigSessionBlobUploadMetadata,
	clearRemoteConfigSessionBlobUpload,
	createClineTelemetryServiceConfig,
	createSessionId,
	createRemoteConfigSessionMessagesArtifactUploader as createSharedRemoteConfigSessionMessagesArtifactUploader,
	type ITelemetryService,
	type OpenTelemetryClientConfig,
	type PreparedRemoteConfigRuntime,
	type PrepareRemoteConfigRuntimeOptions,
	prepareRemoteConfigRuntime,
	REMOTE_CONFIG_SESSION_BLOB_UPLOAD_METADATA_KEY,
	readRemoteConfigSessionBlobUploadMetadata,
	registerRemoteConfigSessionBlobUpload,
} from "@cline/shared";
import type { ClineCoreStartInput } from "../cline-core/types";
import { createConfiguredTelemetryService } from "../services/telemetry";
import type { CreateOpenTelemetryTelemetryServiceOptions } from "../services/telemetry/OpenTelemetryProvider";
import type { SessionMessagesArtifactUploader } from "../types/session";

export interface PrepareRemoteConfigCoreIntegrationOptions
	extends PrepareRemoteConfigRuntimeOptions {
	telemetryService?: Omit<
		CreateOpenTelemetryTelemetryServiceOptions,
		keyof OpenTelemetryClientConfig
	>;
}

export interface PreparedRemoteConfigCoreIntegration {
	prepared: PreparedRemoteConfigRuntime;
	extensions: AgentExtension[];
	telemetry?: ITelemetryService;
	applyToStartSessionInput(input: ClineCoreStartInput): ClineCoreStartInput;
	dispose(): Promise<void>;
}

function createTelemetryService(
	prepared: PreparedRemoteConfigRuntime,
	options: PrepareRemoteConfigCoreIntegrationOptions,
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

export function createRemoteConfigSessionMessagesArtifactUploader(): SessionMessagesArtifactUploader {
	const uploader = createSharedRemoteConfigSessionMessagesArtifactUploader();
	return {
		async uploadMessagesFile(input) {
			await uploader.uploadMessagesFile(input);
		},
	};
}

export async function prepareRemoteConfigCoreIntegration(
	options: PrepareRemoteConfigCoreIntegrationOptions,
): Promise<PreparedRemoteConfigCoreIntegration> {
	const prepared = await prepareRemoteConfigRuntime(options);
	const telemetry = createTelemetryService(prepared, options);
	const extensions = [prepared.pluginDefinition];
	const userDistinctId = prepared.claims?.subject;
	const blobUploadMetadataTemplate = buildRemoteConfigSessionBlobUploadMetadata(
		prepared.bundle?.remoteConfig,
		userDistinctId,
	);
	let registeredSessionId: string | undefined;

	return {
		prepared,
		extensions,
		telemetry,
		applyToStartSessionInput(input: ClineCoreStartInput): ClineCoreStartInput {
			const existingExtensions = input.config.extensions ?? [];
			const existingTelemetry = input.config.telemetry;
			const sessionId = blobUploadMetadataTemplate
				? input.config.sessionId?.trim() || createSessionId()
				: input.config.sessionId;
			if (sessionId && blobUploadMetadataTemplate) {
				registeredSessionId = sessionId;
			}
			const blobUploadMetadata =
				sessionId && blobUploadMetadataTemplate
					? registerRemoteConfigSessionBlobUpload(
							sessionId,
							prepared.bundle?.remoteConfig,
							userDistinctId,
						)
					: undefined;
			const sessionMetadata = blobUploadMetadata
				? {
						...(input.sessionMetadata ?? {}),
						[REMOTE_CONFIG_SESSION_BLOB_UPLOAD_METADATA_KEY]:
							blobUploadMetadata,
					}
				: input.sessionMetadata;
			return {
				...input,
				...(sessionMetadata ? { sessionMetadata } : {}),
				config: {
					...input.config,
					...(sessionId ? { sessionId } : {}),
					extensions: [...existingExtensions, ...extensions],
					telemetry: telemetry ?? existingTelemetry,
				},
			};
		},
		async dispose(): Promise<void> {
			if (registeredSessionId) {
				clearRemoteConfigSessionBlobUpload(registeredSessionId);
			}
		},
	};
}

export {
	buildRemoteConfigSessionBlobUploadMetadata,
	REMOTE_CONFIG_SESSION_BLOB_UPLOAD_METADATA_KEY,
	readRemoteConfigSessionBlobUploadMetadata,
	registerRemoteConfigSessionBlobUpload,
};
