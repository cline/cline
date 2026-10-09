import {
	buildRemoteConfigSessionBlobUploadMetadata,
	ClineAccountService,
	type ClineCoreStartInput,
	createRemoteConfigSessionMessagesArtifactUploader,
	ProviderSettingsManager,
	prepareRemoteConfigCoreIntegration,
	REMOTE_CONFIG_SESSION_BLOB_UPLOAD_METADATA_KEY,
	readRemoteConfigSessionBlobUploadMetadata,
	registerRemoteConfigSessionBlobUpload,
	resolveLocalClineAuthToken,
	type SessionMessagesArtifactUploader,
} from "@cline/core";
import {
	clearMaterializedRemoteConfigRuntime,
	getClineEnvironmentConfig,
	type RemoteConfigBundle,
	RemoteConfigSchema,
} from "@cline/shared";
import { getCliTelemetryService } from "./telemetry";

const initializedRemoteConfigKeys = new Set<string>();
const ENTERPRISE_PLUGIN_NAME = "enterprise";
type CliRemoteConfigResult =
	| { status: "configured"; bundle: RemoteConfigBundle }
	| { status: "disabled" }
	| { status: "unavailable" };

let cliRemoteConfigBundlePromise: Promise<CliRemoteConfigResult> | undefined;
let cliRemoteConfigPreparation: Promise<void> = Promise.resolve();

async function loadCliRemoteConfigBundle(): Promise<CliRemoteConfigResult> {
	cliRemoteConfigBundlePromise ??= loadCliRemoteConfigBundleUncached().finally(
		() => {
			cliRemoteConfigBundlePromise = undefined;
		},
	);
	return await cliRemoteConfigBundlePromise;
}

async function loadCliRemoteConfigBundleUncached(): Promise<CliRemoteConfigResult> {
	const manager = new ProviderSettingsManager();
	const settings = manager.getProviderSettings("cline");
	const authToken = resolveLocalClineAuthToken(settings)?.trim();
	if (!authToken) {
		return { status: "unavailable" };
	}

	const service = new ClineAccountService({
		apiBaseUrl:
			settings?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
		getAuthToken: async () => authToken,
	});
	const response = await service.fetchRemoteConfig().catch(() => undefined);
	if (response === null || response?.enabled === false) {
		return { status: "disabled" };
	}
	if (!response?.enabled || !response.value?.trim()) {
		return { status: "unavailable" };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(response.value);
	} catch {
		return { status: "unavailable" };
	}
	const remoteConfigResult = RemoteConfigSchema.safeParse(parsed);
	if (!remoteConfigResult.success) {
		return { status: "unavailable" };
	}

	return {
		status: "configured",
		bundle: {
			source: "cline-account",
			version: response.organizationId?.trim() || "remote-config",
			remoteConfig: remoteConfigResult.data,
		},
	};
}

export function createCliMessagesArtifactUploader() {
	const uploader = createRemoteConfigSessionMessagesArtifactUploader();
	const telemetry = getCliTelemetryService();
	return {
		async uploadMessagesFile(input) {
			const metadata = readRemoteConfigSessionBlobUploadMetadata(input.row);
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

function captureRemoteConfigInitialized(bundle: RemoteConfigBundle): void {
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
	input: ClineCoreStartInput,
) {
	const workspacePath =
		input.config.workspaceRoot?.trim() || input.config.cwd?.trim();
	if (!workspacePath) {
		return undefined;
	}
	// Fetch and disk reconciliation share a queue so an older enabled start
	// cannot recreate instructions after a later disabled start clears them.
	const preparation = cliRemoteConfigPreparation.then(() =>
		prepareCliRemoteConfig(workspacePath),
	);
	cliRemoteConfigPreparation = preparation.then(
		() => {},
		() => {},
	);
	return preparation;
}

async function prepareCliRemoteConfig(workspacePath: string) {
	const result = await loadCliRemoteConfigBundle();
	if (result.status === "disabled") {
		// Reconcile disk instructions before the runtime starts rule discovery.
		await clearMaterializedRemoteConfigRuntime({
			workspacePath,
			pluginName: ENTERPRISE_PLUGIN_NAME,
		});
		return undefined;
	}
	if (result.status === "unavailable") {
		return undefined;
	}
	const { bundle } = result;
	captureRemoteConfigInitialized(bundle);
	return prepareRemoteConfigCoreIntegration({
		workspacePath,
		pluginName: ENTERPRISE_PLUGIN_NAME,
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
	const result = await loadCliRemoteConfigBundle();
	const bundle = result.status === "configured" ? result.bundle : undefined;
	if (bundle) {
		captureRemoteConfigInitialized(bundle);
	}
	if (sessionId) {
		registerRemoteConfigSessionBlobUpload(sessionId, bundle?.remoteConfig);
	}
	const blobUploadMetadata = buildRemoteConfigSessionBlobUploadMetadata(
		bundle?.remoteConfig,
	);
	if (!blobUploadMetadata) {
		return undefined;
	}
	return {
		[REMOTE_CONFIG_SESSION_BLOB_UPLOAD_METADATA_KEY]: blobUploadMetadata,
	};
}
