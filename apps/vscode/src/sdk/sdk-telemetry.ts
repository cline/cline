import {
	type ConfiguredTelemetryHandle,
	createClineTelemetryServiceConfig,
	createConfiguredTelemetryHandle,
	type ITelemetryService,
	type TelemetryMetadata,
	type TelemetryProperties,
} from "@cline/core"
import * as os from "os"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { getDistinctId } from "@/services/logging/distinctId"
import { getRolloutTelemetryMetadata } from "@/services/telemetry/rollout-metadata"
import { Setting } from "@/shared/proto/index.host"
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

type TelemetrySettingsEvent = { isEnabled: Setting }

export function createVscodeSdkTelemetryHandle(options: CreateVscodeSdkTelemetryHandleOptions = {}): VscodeSdkTelemetryHandle {
	const sdkHandle =
		options.telemetryHandle ??
		createConfiguredTelemetryHandle({
			...createClineTelemetryServiceConfig({
				metadata: {
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
					...options.metadata,
				},
			}),
			commonProperties: getRolloutTelemetryMetadata(),
			distinctId: getDistinctId() || undefined,
			// telemetry.provider_created is otherwise captured during construction,
			// before the host identity resolves; VscodeTelemetryPolicyService emits
			// it once the getHostVersion metadata has been applied.
			deferProviderCreatedEvent: true,
		})

	const telemetry = new VscodeTelemetryPolicyService(sdkHandle)
	return {
		telemetry,
		flush: () => telemetry.flush(),
		dispose: () => telemetry.dispose(),
	}
}

export class VscodeTelemetryPolicyService implements ITelemetryService {
	private hostTelemetryEnabled = false
	private disposed = false
	private unsubscribeHostTelemetrySettings?: () => void
	private receivedHostSubscriptionUpdate = false
	private providerCreatedEmitted = false

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
		if (!this.isOrdinaryTelemetryAllowed()) {
			return
		}
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
		this.unsubscribeHostTelemetrySettings?.()
		this.unsubscribeHostTelemetrySettings = undefined
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
		// Resolve host-derived metadata first and only then let events flow: the gate
		// below (and every subscription update) waits on this promise, so no event —
		// including the deferred provider_created — is emitted before the host
		// identity metadata is in place. Never rejects: resolveHostMetadata catches.
		const hostMetadataApplied = this.resolveHostMetadata().then((hostMetadata) => {
			if (Object.keys(hostMetadata).length > 0) {
				this.handle.telemetry.updateMetadata(hostMetadata)
			}
			this.emitProviderCreatedOnce()
		})

		Promise.all([hostMetadataApplied, HostProvider.env.getTelemetrySettings({})])
			.then(([, settings]) => {
				// A subscription event is always newer than the initial fetch; don't
				// let a slow fetch overwrite a setting change that already arrived.
				if (!this.receivedHostSubscriptionUpdate) {
					this.applyHostTelemetrySetting(settings.isEnabled)
				}
			})
			.catch((error) => {
				Logger.warn("[SdkTelemetry] Failed to read host telemetry setting; keeping SDK telemetry disabled", error)
			})

		try {
			this.unsubscribeHostTelemetrySettings = HostProvider.env.subscribeToTelemetrySettings(
				{},
				{
					onResponse: (event: TelemetrySettingsEvent) => {
						this.receivedHostSubscriptionUpdate = true
						// Chain on the metadata promise so a setting flip cannot open the
						// gate while the host identity is still resolving. Chained callbacks
						// run in attach order, so multiple updates apply in arrival order.
						hostMetadataApplied.then(() => this.applyHostTelemetrySetting(event.isEnabled))
					},
					onError: (error: Error) => {
						Logger.warn("[SdkTelemetry] Host telemetry subscription failed; keeping last known state", error)
					},
				},
			)
		} catch (error) {
			Logger.warn("[SdkTelemetry] Failed to subscribe to host telemetry changes", error)
		}
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

	private applyHostTelemetrySetting(setting: Setting): void {
		this.hostTelemetryEnabled = setting === Setting.ENABLED || setting === Setting.UNSUPPORTED
	}

	private isOrdinaryTelemetryAllowed(): boolean {
		return this.hostTelemetryEnabled && StateManager.get().getGlobalSettingsKey("telemetrySetting") !== "disabled"
	}

	private isRequiredTelemetryAllowed(): boolean {
		return this.hostTelemetryEnabled
	}

	private isMetricAllowed(required: boolean): boolean {
		return required ? this.isRequiredTelemetryAllowed() : this.isOrdinaryTelemetryAllowed()
	}
}
