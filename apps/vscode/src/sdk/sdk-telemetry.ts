import {
	type ConfiguredTelemetryHandle,
	TelemetryService as CoreTelemetryService,
	createClineTelemetryServiceMetadata,
	type ITelemetryService,
	OpenTelemetryAdapter,
	resolveCoreDistinctId,
	type TelemetryMetadata,
	type TelemetryProperties,
} from "@cline/core"
import * as os from "os"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { getDistinctId } from "@/services/logging/distinctId"
import { flushSharedOtelClients, getSharedOtelClients, type SharedOtelClient } from "@/services/telemetry/otel-clients"
import { getRolloutTelemetryMetadata } from "@/services/telemetry/rollout-metadata"
import {
	ensureTelemetryPolicyInitialized,
	isHostTelemetryEnabled,
	isTelemetryExportAllowed,
} from "@/services/telemetry/telemetry-policy"
import { Logger } from "@/shared/services/Logger"

export interface VscodeSdkTelemetryHandle {
	readonly telemetry: ITelemetryService
	flush(): Promise<void>
	dispose(): Promise<void>
}

export interface CreateVscodeSdkTelemetryHandleOptions {
	telemetryHandle?: ConfiguredTelemetryHandle
	metadata?: Partial<TelemetryMetadata>
}

export function createVscodeSdkTelemetryHandle(options: CreateVscodeSdkTelemetryHandleOptions = {}): VscodeSdkTelemetryHandle {
	const sdkHandle = options.telemetryHandle ?? createSharedStackTelemetryHandle(options.metadata)

	const telemetry = new VscodeTelemetryPolicyService(sdkHandle)
	return {
		telemetry,
		flush: () => telemetry.flush(),
		dispose: () => telemetry.dispose(),
	}
}

/**
 * Builds the SDK telemetry handle on top of the process's shared OpenTelemetry
 * clients (see {@link getSharedOtelClients}) instead of a second, private
 * exporter stack. One adapter is bound per shared client, each gated by the
 * shared telemetry policy with that destination's bypass flag — so the SDK
 * pipeline and the classic host pipeline always agree, per destination, on
 * whether an event exports (ENG-2397).
 */
function createSharedStackTelemetryHandle(metadataOverrides: Partial<TelemetryMetadata> = {}): ConfiguredTelemetryHandle {
	// The adapters' enabled closures read the shared policy state; start
	// resolving it now so the host setting is known as early as possible.
	void ensureTelemetryPolicyInitialized()

	const metadata = createClineTelemetryServiceMetadata({
		extension_version: ExtensionRegistryInfo.version,
		// VscodeTelemetryPolicyService replaces these with the authoritative
		// getHostVersion values before any event is emitted. "unknown" surfaces
		// a failed host version lookup instead of mislabeling the host as VSCode.
		cline_type: "unknown",
		platform: "unknown",
		platform_version: "unknown",
		os_type: process.platform,
		os_version: os.version(),
		is_dev: process.env.IS_DEV,
		...metadataOverrides,
	})

	const clients = getSharedOtelClients()
	const adapters = clients.map(
		({ client, bypassUserSettings }) =>
			new OpenTelemetryAdapter({
				metadata,
				meterProvider: client.meterProvider,
				loggerProvider: client.loggerProvider,
				enabled: () => isTelemetryExportAllowed(bypassUserSettings),
				// The shared clients are owned by the process-wide registry
				// (disposed during extension teardown), not this handle.
				ownsProviders: false,
			}),
	)

	const telemetry = new CoreTelemetryService({
		adapters,
		metadata,
		distinctId: resolveCoreDistinctId(getDistinctId() || undefined),
		commonProperties: getRolloutTelemetryMetadata(),
	})

	const flush = async (): Promise<void> => {
		try {
			await flushSharedOtelClients()
		} catch {
			// best-effort flush; swallow to avoid blocking shutdown paths
		}
	}

	const dispose = async (): Promise<void> => {
		// The adapters do not own the shared clients, so this releases only the
		// handle; the client registry shuts the exporters down at teardown.
		await Promise.allSettled([telemetry.dispose(), flush()])
	}

	return {
		telemetry,
		flush,
		dispose,
		// telemetry.provider_created is emitted by VscodeTelemetryPolicyService
		// once the host identity metadata has been applied (mirrors the
		// deferProviderCreatedEvent flow the private stack used).
		...(clients.length > 0 ? { emitProviderCreated: () => emitProviderCreated(telemetry, clients) } : {}),
	}
}

/**
 * Emits the same `telemetry.provider_created` event (name and attribute keys)
 * that `createOpenTelemetryTelemetryService` in @cline/core emits, describing
 * the primary shared destination this handle exports through.
 */
function emitProviderCreated(telemetry: ITelemetryService, clients: SharedOtelClient[]): void {
	const primary = clients[0]
	telemetry.captureRequired("telemetry.provider_created", {
		provider: "opentelemetry",
		enabled: true,
		logsExporter: primary.config.logsExporter,
		metricsExporter: primary.config.metricsExporter,
		tracesExporter: undefined,
		otlpProtocol: primary.config.otlpProtocol,
		hasOtlpEndpoint: Boolean(primary.config.otlpEndpoint),
		serviceName: undefined,
		serviceVersion: undefined,
	})
}

export class VscodeTelemetryPolicyService implements ITelemetryService {
	private disposed = false
	private providerCreatedEmitted = false
	/**
	 * No event may be emitted before the authoritative host identity metadata is
	 * applied; per-destination export decisions past this gate belong to the
	 * shared telemetry policy (via the handle's adapters).
	 */
	private hostMetadataReady = false

	constructor(private readonly handle: ConfiguredTelemetryHandle) {
		this.initializeHostTelemetryState()
	}

	setDistinctId(distinctId?: string): void {
		this.handle.telemetry.setDistinctId(distinctId)
	}

	setMetadata(metadata: Partial<TelemetryMetadata>): void {
		this.handle.telemetry.setMetadata(metadata)
	}

	updateMetadata(metadata: Partial<TelemetryMetadata>): void {
		this.handle.telemetry.updateMetadata(metadata)
	}

	setCommonProperties(properties: TelemetryProperties): void {
		this.handle.telemetry.setCommonProperties(properties)
	}

	updateCommonProperties(properties: TelemetryProperties): void {
		this.handle.telemetry.updateCommonProperties(properties)
	}

	isEnabled(): boolean {
		return this.isOrdinaryTelemetryAllowed() && this.handle.telemetry.isEnabled()
	}

	capture(input: { event: string; properties?: TelemetryProperties }): void {
		if (!this.hostMetadataReady) {
			return
		}
		// Per-destination gating (host + user settings, bypass flags) happens in
		// the handle's adapters via the shared telemetry policy.
		this.handle.telemetry.capture(input)
	}

	captureRequired(event: string, properties?: TelemetryProperties): void {
		if (!this.isRequiredTelemetryAllowed()) {
			return
		}
		this.handle.telemetry.captureRequired(event, properties)
	}

	recordCounter(name: string, value: number, attributes?: TelemetryProperties, description?: string, required = false): void {
		if (!this.isMetricAllowed(required)) {
			return
		}
		this.handle.telemetry.recordCounter(name, value, attributes, description, required)
	}

	recordHistogram(name: string, value: number, attributes?: TelemetryProperties, description?: string, required = false): void {
		if (!this.isMetricAllowed(required)) {
			return
		}
		this.handle.telemetry.recordHistogram(name, value, attributes, description, required)
	}

	recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		if (!this.isMetricAllowed(required)) {
			return
		}
		this.handle.telemetry.recordGauge(name, value, attributes, description, required)
	}

	async flush(): Promise<void> {
		await this.handle.flush()
		await this.handle.telemetry.flush()
	}

	async dispose(): Promise<void> {
		if (this.disposed) {
			return
		}
		this.disposed = true
		// If the host-version lookup is still pending, emit the deferred
		// provider_created now (with the construction-time fallback identity, as the
		// undeferred event always did) so disposal never swallows the required event.
		this.emitProviderCreatedOnce()
		await this.handle.dispose()
	}

	private emitProviderCreatedOnce(): void {
		if (this.providerCreatedEmitted) {
			return
		}
		this.providerCreatedEmitted = true
		this.handle.emitProviderCreated?.()
	}

	private initializeHostTelemetryState(): void {
		// The shared policy module owns the host telemetry setting (fetch +
		// subscription); this service only sequences metadata: resolve the
		// host-derived identity first and only then let events flow, so no event —
		// including the deferred provider_created — is emitted before the host
		// identity metadata is in place. Never rejects: resolveHostMetadata catches.
		void ensureTelemetryPolicyInitialized()
		this.resolveHostMetadata().then((hostMetadata) => {
			if (Object.keys(hostMetadata).length > 0) {
				this.handle.telemetry.updateMetadata(hostMetadata)
			}
			this.hostMetadataReady = true
			this.emitProviderCreatedOnce()
		})
	}

	// Mirrors the classic TelemetryService.create() mapping of GetHostVersionResponse
	// fields, so both pipelines report the same host identity. Fields the host does not
	// report are left out to keep the handle's construction-time "unknown" fallbacks.
	private async resolveHostMetadata(): Promise<Partial<TelemetryMetadata>> {
		try {
			const hostVersion = await HostProvider.env.getHostVersion({})
			return {
				...(hostVersion.clineVersion ? { host_plugin_version: hostVersion.clineVersion } : {}),
				...(hostVersion.clineType ? { cline_type: hostVersion.clineType } : {}),
				...(hostVersion.platform ? { platform: hostVersion.platform } : {}),
				...(hostVersion.version ? { platform_version: hostVersion.version } : {}),
			}
		} catch (error) {
			Logger.warn("[SdkTelemetry] Failed to resolve host version for telemetry metadata", error)
			return {}
		}
	}

	private isOrdinaryTelemetryAllowed(): boolean {
		return this.hostMetadataReady && isTelemetryExportAllowed(false)
	}

	private isRequiredTelemetryAllowed(): boolean {
		return this.hostMetadataReady && isHostTelemetryEnabled()
	}

	private isMetricAllowed(required: boolean): boolean {
		return required ? this.isRequiredTelemetryAllowed() : this.hostMetadataReady
	}
}
