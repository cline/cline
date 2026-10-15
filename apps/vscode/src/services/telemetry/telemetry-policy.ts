import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { getErrorLevelFromString } from "@/services/error"
import { Setting } from "@/shared/proto/index.host"
import { Logger } from "@/shared/services/Logger"

/**
 * Single telemetry opt-out policy for the whole process.
 *
 * Every telemetry destination — the classic host providers (PostHog, OpenTelemetry)
 * and the SDK handle's adapters — must derive its export decision from
 * {@link isTelemetryExportAllowed} so the process cannot simultaneously honor and
 * ignore the user's telemetry choice (ENG-2397).
 */

/**
 * Policy: telemetry destinations that the user (via `CLINE_OTEL_*` environment
 * variables) or an organization (via remote config) explicitly configured export
 * telemetry even when the user's Cline telemetry setting or the host (IDE)
 * telemetry setting is off.
 *
 * Rationale: the collector was deliberately configured by the party receiving the
 * data — the user's opt-out governs Cline's collection, not a collector the
 * user/org pointed at themselves. This is documented behavior:
 * https://docs.cline.bot/enterprise-solutions/monitoring/opentelemetry_override
 * ("Environment variable configuration bypasses user telemetry settings").
 * This constant preserves the classic pipeline's long-standing behavior and now
 * applies uniformly to SDK-handle telemetry too. Removing the bypass means
 * changing that documented contract, not just flipping this to false.
 */
export const RUNTIME_ENV_OTEL_BYPASSES_USER_OPT_OUT = true

type HostTelemetryLevel = "all" | "off" | "error" | "crash"

interface HostTelemetryState {
	enabled: boolean
	level: HostTelemetryLevel
	/** A subscription event is always newer than the initial fetch; don't let a slow fetch clobber it. */
	receivedSubscriptionUpdate: boolean
}

// Until the initial fetch resolves, treat host telemetry as disabled so nothing
// exports before the host's choice is known (matches the previous SDK-pipeline
// behavior; the classic factory awaits initialization before creating providers).
const state: HostTelemetryState = {
	enabled: false,
	level: "all",
	receivedSubscriptionUpdate: false,
}

let initPromise: Promise<void> | null = null
let unsubscribeHostTelemetrySettings: (() => void) | undefined

function applyHostTelemetrySetting(setting: Setting): void {
	state.enabled = setting === Setting.ENABLED || setting === Setting.UNSUPPORTED
}

/**
 * Starts the single host-telemetry-settings subscription and performs the initial
 * fetch. Idempotent; safe to call from every consumer. Never rejects — on failure
 * the host state stays at its safe default (disabled).
 */
export function ensureTelemetryPolicyInitialized(): Promise<void> {
	if (!initPromise) {
		initPromise = initializeHostTelemetryState()
	}
	return initPromise
}

async function initializeHostTelemetryState(): Promise<void> {
	try {
		unsubscribeHostTelemetrySettings = HostProvider.env.subscribeToTelemetrySettings(
			{},
			{
				onResponse: (event: { isEnabled: Setting }) => {
					state.receivedSubscriptionUpdate = true
					applyHostTelemetrySetting(event.isEnabled)
				},
				onError: (error: Error) => {
					Logger.warn("[TelemetryPolicy] Host telemetry subscription failed; keeping last known state", error)
				},
			},
		)
	} catch (error) {
		Logger.warn("[TelemetryPolicy] Failed to subscribe to host telemetry changes", error)
	}

	try {
		const settings = await HostProvider.env.getTelemetrySettings({})
		if (!state.receivedSubscriptionUpdate) {
			applyHostTelemetrySetting(settings.isEnabled)
		}
		state.level = settings.isEnabled === Setting.DISABLED ? "off" : (getErrorLevelFromString(settings.errorLevel) ?? "all")
	} catch (error) {
		Logger.warn("[TelemetryPolicy] Failed to read host telemetry setting; keeping telemetry disabled", error)
	}
}

/** Whether the host (IDE) telemetry setting currently allows telemetry. */
export function isHostTelemetryEnabled(): boolean {
	return state.enabled
}

/**
 * The host's telemetry level from the initial settings fetch ("all" | "off" |
 * "error" | "crash"). Destinations that bypass user settings ignore this.
 */
export function getHostTelemetryLevel(): HostTelemetryLevel {
	return state.level
}

/** Whether the user's Cline telemetry setting allows telemetry. */
export function isUserTelemetryOptedIn(): boolean {
	return StateManager.get().getGlobalSettingsKey("telemetrySetting") !== "disabled"
}

/**
 * The process-wide opt-out checkpoint for ordinary (non-required) telemetry.
 *
 * @param bypassUserSettings true only for destinations explicitly configured by
 * the receiving party (runtime `CLINE_OTEL_*` env collectors, remote-config org
 * collectors) — see {@link RUNTIME_ENV_OTEL_BYPASSES_USER_OPT_OUT}.
 */
export function isTelemetryExportAllowed(bypassUserSettings: boolean): boolean {
	return bypassUserSettings || (state.enabled && isUserTelemetryOptedIn())
}

/** Tears down the host-settings subscription. Called from extension teardown. */
export function disposeTelemetryPolicy(): void {
	unsubscribeHostTelemetrySettings?.()
	unsubscribeHostTelemetrySettings = undefined
}

/** Test-only: reset module state between test cases. */
export function resetTelemetryPolicyForTests(): void {
	disposeTelemetryPolicy()
	initPromise = null
	state.enabled = false
	state.level = "all"
	state.receivedSubscriptionUpdate = false
}
