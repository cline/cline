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
					// cline_type/platform/platform_version are fallbacks for when the host
					// version lookup fails; VscodeTelemetryPolicyService replaces them with
					// the authoritative getHostVersion values before any event is emitted.
					cline_type: "VSCode Extension",
					platform: "VS Code",
					platform_version: "unknown",
					os_type: process.platform,
					os_version: os.version(),
					is_dev: process.env.IS_DEV,
					...options.metadata,
				},
			}),
			commonProperties: getRolloutTelemetryMetadata(),
			distinctId: getDistinctId() || undefined,
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
		await this.handle.dispose()
	}

	private initializeHostTelemetryState(): void {
		// Resolve host-derived metadata together with the telemetry setting and apply
		// it first: events stay gated until the setting is applied, so this ordering
		// guarantees no event is emitted before the host identity metadata is in place.
		Promise.all([this.resolveHostMetadata(), HostProvider.env.getTelemetrySettings({})])
			.then(([hostMetadata, settings]) => {
				if (Object.keys(hostMetadata).length > 0) {
					this.handle.telemetry.updateMetadata(hostMetadata)
				}
				this.applyHostTelemetrySetting(settings.isEnabled)
			})
			.catch((error) => {
				Logger.warn("[SdkTelemetry] Failed to read host telemetry setting; keeping SDK telemetry disabled", error)
			})

		try {
			this.unsubscribeHostTelemetrySettings = HostProvider.env.subscribeToTelemetrySettings(
				{},
				{
					onResponse: (event: TelemetrySettingsEvent) => {
						this.applyHostTelemetrySetting(event.isEnabled)
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
	// report are left out to keep the handle's construction-time fallbacks.
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
