import {
	ClineAccountService,
	ProviderSettingsManager,
	resolveLocalClineAuthToken,
	type SessionMessagesArtifactUploader,
	type StartSessionInput,
} from "@clinebot/core";
import {
	buildEnterpriseSessionBlobUploadMetadata,
	createEnterpriseSessionMessagesArtifactUploader,
	ENTERPRISE_SESSION_BLOB_UPLOAD_METADATA_KEY,
	type EnterpriseConfigBundle,
	prepareEnterpriseCoreIntegration,
	readEnterpriseSessionBlobUploadMetadata,
	registerEnterpriseSessionBlobUpload,
} from "@clinebot/enterprise";
import { RemoteConfigSchema } from "@clinebot/shared";
import { getCliTelemetryService } from "./telemetry";

const DEFAULT_CLINE_API_BASE_URL = "https://api.cline.bot";
const initializedRemoteConfigKeys = new Set<string>();

async function loadCliRemoteConfigBundle(): Promise<
	EnterpriseConfigBundle | undefined
> {
	const manager = new ProviderSettingsManager();
	const settings = manager.getProviderSettings("cline");
	const authToken = resolveLocalClineAuthToken(settings)?.trim();
	if (!authToken) {
		return undefined;
	}

	const service = new ClineAccountService({
		apiBaseUrl: settings?.baseUrl?.trim() || DEFAULT_CLINE_API_BASE_URL,
		getAuthToken: async () => authToken,
	});
	const response = await service.fetchRemoteConfig().catch(() => null);
	if (!response?.enabled || !response.value?.trim()) {
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(response.value);
	} catch {
		return undefined;
	}
	const remoteConfigResult = RemoteConfigSchema.safeParse(parsed);
	if (!remoteConfigResult.success) {
		return undefined;
	}

	return {
		source: "cline-account",
		version: response.organizationId?.trim() || "remote-config",
		remoteConfig: remoteConfigResult.data,
	};
}

export function createCliMessagesArtifactUploader() {
	const uploader = createEnterpriseSessionMessagesArtifactUploader();
	const telemetry = getCliTelemetryService();
	return {
		async uploadMessagesFile(input) {
			const metadata = readEnterpriseSessionBlobUploadMetadata(input.row);
			const startedAt = Date.now();
			try {
				await uploader.uploadMessagesFile(input);
				if (!metadata) {
					return;
				}
				telemetry?.capture?.({
					event: "enterprise.prompt_upload_succeeded",
					properties: {
						sessionId: input.sessionId,
						adapterType: metadata.storage.adapterType,
						bucket: metadata.storage.bucket,
						keyPrefix: metadata.keyPrefix,
						bytes: input.contents.length,
						durationMs: Date.now() - startedAt,
					},
				});
			} catch (error) {
				telemetry?.capture?.({
					event: "enterprise.prompt_upload_failed",
					properties: {
						sessionId: input.sessionId,
						adapterType: metadata?.storage.adapterType,
						bucket: metadata?.storage.bucket,
						keyPrefix: metadata?.keyPrefix,
						bytes: input.contents.length,
						durationMs: Date.now() - startedAt,
						error: error instanceof Error ? error.message : String(error),
					},
				});
				throw error;
			}
		},
	} satisfies SessionMessagesArtifactUploader;
}

function captureRemoteConfigInitialized(bundle: EnterpriseConfigBundle): void {
	const telemetry = getCliTelemetryService();
	const key = `${bundle.source}:${bundle.version}`;
	if (initializedRemoteConfigKeys.has(key)) {
		return;
	}
	initializedRemoteConfigKeys.add(key);
	const promptUploading =
		bundle.remoteConfig?.enterpriseTelemetry?.promptUploading;
	telemetry?.capture?.({
		event: "enterprise.remote_config_initialized",
		properties: {
			source: bundle.source,
			version: bundle.version,
			hasPromptUploading: Boolean(promptUploading),
			promptUploadingType: promptUploading?.type,
			promptUploadingEnabled: promptUploading?.enabled !== false,
			hasGlobalRules: (bundle.remoteConfig?.globalRules?.length ?? 0) > 0,
			hasGlobalWorkflows:
				(bundle.remoteConfig?.globalWorkflows?.length ?? 0) > 0,
		},
	});
}

export async function prepareCliEnterpriseIntegration(
	input: StartSessionInput,
) {
	const bundle = await loadCliRemoteConfigBundle();
	if (!bundle) {
		return undefined;
	}
	captureRemoteConfigInitialized(bundle);
	return prepareEnterpriseCoreIntegration({
		workspacePath: input.config.workspaceRoot ?? input.config.cwd,
		controlPlane: {
			name: "cline-account",
			async fetchBundle() {
				return bundle;
			},
		},
		requireBundle: false,
	});
}

export async function resolveCliSessionMetadata(
	sessionId?: string,
): Promise<Record<string, unknown> | undefined> {
	const bundle = await loadCliRemoteConfigBundle();
	if (bundle) {
		captureRemoteConfigInitialized(bundle);
	}
	if (sessionId) {
		registerEnterpriseSessionBlobUpload(sessionId, bundle?.remoteConfig);
	}
	const blobUploadMetadata = buildEnterpriseSessionBlobUploadMetadata(
		bundle?.remoteConfig,
	);
	if (!blobUploadMetadata) {
		return undefined;
	}
	return {
		[ENTERPRISE_SESSION_BLOB_UPLOAD_METADATA_KEY]: blobUploadMetadata,
	};
}
