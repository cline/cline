import type { ClineCoreOptions } from "../../cline-core/types";
import {
	ensureCompatibleLocalHubUrl,
	resolveCompatibleLocalHubUrl,
} from "../../hub/client";
import { prewarmDetachedHubServer } from "../../hub/daemon";
import { HubRuntimeHost } from "../../hub/runtime-host/hub-runtime-host";
import { RemoteRuntimeHost } from "../../hub/runtime-host/remote-runtime-host";
import { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import { resolveCoreDistinctId } from "../../services/telemetry/distinct-id";
import { FileSessionService } from "../../session/services/file-session-service";
import { CoreSessionService } from "../../session/services/session-service";
import { LocalRuntimeHost } from "./local-runtime-host";
import type { RuntimeHost, RuntimeHostMode } from "./runtime-host";

function resolveConfiguredBackendMode(
	options: ClineCoreOptions,
): RuntimeHostMode {
	if (options.backendMode) {
		return options.backendMode;
	}
	if (process.env.CLINE_VCR?.trim()) {
		return "local";
	}
	const raw = process.env.CLINE_SESSION_BACKEND_MODE?.trim().toLowerCase();
	if (raw === "local" || raw === "hub" || raw === "remote") {
		return raw;
	}
	return "auto";
}

export type SessionBackend = CoreSessionService | FileSessionService;

let cachedBackend: SessionBackend | undefined;
let backendInitPromise: Promise<SessionBackend> | undefined;

function prewarmLocalHubIfNeeded(
	configuredMode: RuntimeHostMode,
	options: ClineCoreOptions,
): void {
	if (configuredMode !== "auto" && configuredMode !== "hub") {
		return;
	}
	if (options.hub?.endpoint?.trim()) {
		return;
	}
	prewarmDetachedHubServer(
		options.hub?.workspaceRoot?.trim() ||
			options.hub?.cwd?.trim() ||
			process.cwd(),
	);
}

async function reconcileDeadSessionsIfSupported(
	backend: SessionBackend,
): Promise<void> {
	const service = backend as SessionBackend & {
		reconcileDeadSessions?: (limit?: number) => Promise<number>;
	};
	await service.reconcileDeadSessions?.().catch(() => {});
}

function createLocalBackend(options: ClineCoreOptions): SessionBackend {
	try {
		const store = new SqliteSessionStore();
		store.init();
		return new CoreSessionService(store, {
			messagesArtifactUploader: options.messagesArtifactUploader,
		});
	} catch {
		// Fallback to file-based session service if SQLite is unavailable.
		options.telemetry?.capture({
			event: "session_backend_fallback",
			properties: {
				requestedBackend: "sqlite",
				fallbackBackend: "file",
			},
		});
		return new FileSessionService(undefined, {
			messagesArtifactUploader: options.messagesArtifactUploader,
		});
	}
}

function createLocalRuntimeHost(
	options: ClineCoreOptions,
	distinctId: string,
	backend?: SessionBackend,
): LocalRuntimeHost {
	return new LocalRuntimeHost({
		sessionService:
			backend ?? options.sessionService ?? createLocalBackend(options),
		capabilities: options.capabilities,
		telemetry: options.telemetry,
		toolPolicies: options.toolPolicies,
		distinctId,
		fetch: options.fetch,
	});
}

export async function resolveSessionBackend(
	options: ClineCoreOptions,
): Promise<SessionBackend> {
	if (cachedBackend) {
		return cachedBackend;
	}
	if (backendInitPromise) {
		return await backendInitPromise;
	}

	backendInitPromise = (async () => {
		cachedBackend = createLocalBackend(options);
		await reconcileDeadSessionsIfSupported(cachedBackend);
		return cachedBackend;
	})().finally(() => {
		backendInitPromise = undefined;
	});

	return await backendInitPromise;
}

export async function createRuntimeHost(
	options: ClineCoreOptions,
): Promise<RuntimeHost> {
	const distinctId = resolveCoreDistinctId(options.distinctId);
	options.telemetry?.setDistinctId(distinctId);
	const configuredMode = resolveConfiguredBackendMode(options);
	prewarmLocalHubIfNeeded(configuredMode, options);
	if (configuredMode === "remote") {
		const remoteEndpoint = options.remote?.endpoint?.trim();
		if (!remoteEndpoint) {
			throw new Error(
				"Remote runtime mode requires `remote.endpoint` to be configured.",
			);
		}
		options.logger?.log("Using remote runtime host", {
			endpoint: remoteEndpoint,
		});
		return new RemoteRuntimeHost({
			endpoint: remoteEndpoint,
			authToken: options.remote?.authToken,
			clientType: options.remote?.clientType,
			displayName: options.remote?.displayName,
			workspaceRoot: options.remote?.workspaceRoot,
			cwd: options.remote?.cwd,
			capabilities: options.capabilities,
		});
	}
	if (configuredMode === "hub") {
		const explicitEndpoint = options.hub?.endpoint?.trim();
		const hubUrl =
			explicitEndpoint ||
			(await ensureCompatibleLocalHubUrl({
				strategy: options.hub?.strategy ?? "require-hub",
				workspaceRoot: options.hub?.workspaceRoot,
				cwd: options.hub?.cwd,
			}));
		if (!hubUrl) {
			throw new Error("No compatible hub runtime is available.");
		}
		options.logger?.log("Using hub runtime host", {
			url: hubUrl,
			explicitEndpoint: explicitEndpoint || undefined,
		});
		return new HubRuntimeHost(
			{
				url: hubUrl,
				authToken: options.hub?.authToken,
				clientType: options.hub?.clientType,
				displayName: options.hub?.displayName,
				capabilities: options.capabilities,
			},
			{
				workspaceRoot: options.hub?.workspaceRoot,
				cwd: options.hub?.cwd,
			},
		);
	}
	if (configuredMode === "auto") {
		const hubUrl = await resolveCompatibleLocalHubUrl({
			endpoint: options.hub?.endpoint,
			strategy: options.hub?.strategy ?? "prefer-hub",
			workspaceRoot: options.hub?.workspaceRoot,
			cwd: options.hub?.cwd,
		});
		if (hubUrl) {
			options.logger?.log("Using discovered local hub runtime host", {
				url: hubUrl,
			});
			const host = new HubRuntimeHost(
				{
					url: hubUrl,
					authToken: options.hub?.authToken,
					clientType: options.hub?.clientType,
					displayName: options.hub?.displayName,
					capabilities: options.capabilities,
				},
				{
					workspaceRoot: options.hub?.workspaceRoot,
					cwd: options.hub?.cwd,
				},
			);
			try {
				await host.connect();
				return host;
			} catch (error) {
				options.logger?.log("Falling back to local runtime host", {
					reason: "hub_connect_failed",
					severity: "warn",
					error,
				});
			}
		}
		options.logger?.log("Falling back to local runtime host", {
			reason: "compatible_hub_unavailable",
			severity: "warn",
		});
		return createLocalRuntimeHost(options, distinctId);
	}
	return createLocalRuntimeHost(options, distinctId);
}
