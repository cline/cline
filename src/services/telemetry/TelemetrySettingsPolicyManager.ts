import { HostProvider } from "@/hosts/host-provider"
import { Setting } from "@/shared/proto/index.host"

export type TelemetryLevel = "off" | "error" | "all"

export interface TelemetryEffectivePolicy {
	hostSetting: Setting
	userOptIn: boolean
	environmentDisabled: boolean
	isTelemetryAllowed: boolean
	level: TelemetryLevel
}

export type TelemetrySettingsListener = (policy: TelemetryEffectivePolicy) => void

export interface TelemetrySettingsPolicyManagerOptions {
	hostProvider?: typeof HostProvider
	getUserOptIn: () => Promise<boolean>
	onUserOptInChange?: (listener: (optIn: boolean) => void) => () => void
	getTelemetryLevel?: () => Promise<TelemetryLevel>
	environmentOverrides?: {
		telemetryDisabled?: boolean
	}
}

const DEFAULT_LEVEL: TelemetryLevel = "all"

/**
 * Central authority for computing whether telemetry is permitted.
 * Aggregates host telemetry status, user opt-in preference, and environment overrides.
 */
export class TelemetrySettingsPolicyManager {
	private readonly listeners: Set<TelemetrySettingsListener> = new Set()
	private readonly hostProvider: typeof HostProvider
	private readonly getUserOptIn: () => Promise<boolean>
	private readonly onUserOptInChange?: (listener: (optIn: boolean) => void) => () => void
	private readonly getTelemetryLevel?: () => Promise<TelemetryLevel>
	private readonly environmentOverrides?: TelemetrySettingsPolicyManagerOptions["environmentOverrides"]

	private currentPolicy: TelemetryEffectivePolicy | null = null
	private readyResolver!: () => void
	private readonly readyPromise: Promise<void>
	private unsubscribeHostTelemetry?: () => void
	private unsubscribeUserOptIn?: () => void

	constructor(options: TelemetrySettingsPolicyManagerOptions) {
		this.hostProvider = options.hostProvider ?? HostProvider
		this.getUserOptIn = options.getUserOptIn
		this.onUserOptInChange = options.onUserOptInChange
		this.getTelemetryLevel = options.getTelemetryLevel
		this.environmentOverrides = options.environmentOverrides

		this.readyPromise = new Promise<void>((resolve) => {
			this.readyResolver = resolve
		})
	}

	public async load(): Promise<void> {
		const [hostSetting, userOptIn, level] = await Promise.all([
			this.fetchHostTelemetrySetting(),
			this.getUserOptIn(),
			this.computeTelemetryLevel(),
		])

		this.currentPolicy = this.computePolicy(hostSetting, userOptIn, level)
		this.readyResolver()

		this.subscribeToHostTelemetry()
		this.subscribeToUserOptIn()
	}

	public getCurrentPolicy(): TelemetryEffectivePolicy {
		if (!this.currentPolicy) {
			throw new Error("TelemetrySettingsPolicyManager: policy accessed before load()")
		}
		return this.currentPolicy
	}

	public waitUntilReady(): Promise<void> {
		return this.readyPromise
	}

	public subscribe(listener: TelemetrySettingsListener): () => void {
		this.listeners.add(listener)
		if (this.currentPolicy) {
			listener(this.currentPolicy)
		}
		return () => {
			this.listeners.delete(listener)
		}
	}

	public dispose(): void {
		this.listeners.clear()
		this.unsubscribeHostTelemetry?.()
		this.unsubscribeUserOptIn?.()
	}

	private subscribeToHostTelemetry(): void {
		this.unsubscribeHostTelemetry = this.hostProvider.env.subscribeToTelemetrySettings(
			{},
			{
				onResponse: (event) => {
					const hostSetting = event.isEnabled
					this.handlePolicyChange({ hostSetting })
				},
				onError: (error) => {
					console.error("[TelemetrySettingsPolicyManager] Host telemetry subscription error:", error)
				},
			},
		)
	}

	private subscribeToUserOptIn(): void {
		if (!this.onUserOptInChange) {
			return
		}

		this.unsubscribeUserOptIn = this.onUserOptInChange((optIn) => {
			this.handlePolicyChange({ userOptIn: optIn })
		})
	}

	private async fetchHostTelemetrySetting(): Promise<Setting> {
		try {
			const response = await this.hostProvider.env.getTelemetrySettings({})
			return response.isEnabled
		} catch (error) {
			console.error("[TelemetrySettingsPolicyManager] Failed to fetch host telemetry setting:", error)
			return Setting.UNSUPPORTED
		}
	}

	private async computeTelemetryLevel(): Promise<TelemetryLevel> {
		if (!this.getTelemetryLevel) {
			return DEFAULT_LEVEL
		}

		try {
			return await this.getTelemetryLevel()
		} catch (error) {
			console.error("[TelemetrySettingsPolicyManager] Failed to resolve telemetry level:", error)
			return DEFAULT_LEVEL
		}
	}

	private computePolicy(hostSetting: Setting, userOptIn: boolean, level: TelemetryLevel): TelemetryEffectivePolicy {
		const environmentDisabled = this.environmentOverrides?.telemetryDisabled === true
		const isTelemetryAllowed = this.resolveTelemetryAllowed(hostSetting, userOptIn, environmentDisabled, level)

		return {
			hostSetting,
			userOptIn,
			environmentDisabled,
			isTelemetryAllowed,
			level: level ?? DEFAULT_LEVEL,
		}
	}

	private resolveTelemetryAllowed(
		hostSetting: Setting,
		userOptIn: boolean,
		environmentDisabled: boolean,
		level: TelemetryLevel,
	): boolean {
		if (environmentDisabled) {
			return false
		}

		if (hostSetting === Setting.DISABLED) {
			return false
		}

		if (!userOptIn) {
			return false
		}

		if (level === "off") {
			return false
		}

		return true
	}

	public async refreshTelemetryLevel(): Promise<void> {
		const nextLevel = await this.computeTelemetryLevel()
		this.handlePolicyChange({ level: nextLevel })
	}

	public setTelemetryLevel(level: TelemetryLevel): void {
		this.handlePolicyChange({ level })
	}

	private handlePolicyChange(partial: Partial<Pick<TelemetryEffectivePolicy, "hostSetting" | "userOptIn" | "level">>): void {
		if (!this.currentPolicy) {
			return
		}

		const nextPolicyInput: TelemetryEffectivePolicy = {
			...this.currentPolicy,
			...partial,
			environmentDisabled: this.environmentOverrides?.telemetryDisabled === true,
			isTelemetryAllowed: this.currentPolicy.isTelemetryAllowed,
		}

		const nextPolicy = this.computePolicy(nextPolicyInput.hostSetting, nextPolicyInput.userOptIn, nextPolicyInput.level)

		if (this.didPolicyChange(this.currentPolicy, nextPolicy)) {
			this.currentPolicy = nextPolicy
			this.listeners.forEach((listener) => listener(nextPolicy))
		}
	}

	private didPolicyChange(previous: TelemetryEffectivePolicy, next: TelemetryEffectivePolicy): boolean {
		return (
			previous.hostSetting !== next.hostSetting ||
			previous.userOptIn !== next.userOptIn ||
			previous.environmentDisabled !== next.environmentDisabled ||
			previous.isTelemetryAllowed !== next.isTelemetryAllowed ||
			previous.level !== next.level
		)
	}
}
