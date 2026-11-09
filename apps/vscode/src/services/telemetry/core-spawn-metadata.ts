/**
 * Spawn-time facts about this cline-core process, reported by the host that
 * launched it. Only out-of-process hosts (the JetBrains plugin) set these; the
 * VS Code extension runs in-process and reports nothing, so the fields are
 * simply absent there, the way `host_plugin_version` is absent on the CLI.
 *
 * Same contract as `IS_DEV` -> `is_dev` and `CLINE_ROLLOUT_VARIANT`: the host
 * states a fact at spawn, core owns the telemetry. Without these, a core that
 * crash-restarted three times and a user with three project windows both look
 * like three `user.extension_activated` events.
 *
 * A crashed core cannot report its own exit, so the spawn right after an
 * unexpected exit also carries the predecessor's exit code and uptime. That is
 * what tells a heap exhausted minutes into a turn from one that leaked for a
 * whole shift, without a heap snapshot. The host decides when those two are
 * present: only on the direct successor of an unexpected exit, whatever that
 * successor's own spawn reason is (a user restart after a crash still reports
 * the crash). The core does not cross-check them against the reason.
 */
import { CORE_SPAWN_REASONS, type CoreSpawnReason } from "@cline/shared"

export const CORE_SPAWN_ORDINAL_ENV = "CLINE_CORE_SPAWN_ORDINAL"
export const CORE_SPAWN_REASON_ENV = "CLINE_CORE_SPAWN_REASON"
export const CORE_PREV_EXIT_CODE_ENV = "CLINE_CORE_PREV_EXIT_CODE"
export const CORE_PREV_UPTIME_S_ENV = "CLINE_CORE_PREV_UPTIME_S"

export { CORE_SPAWN_REASONS, type CoreSpawnReason }

export type CoreSpawnTelemetryMetadata = {
	/** 1-based count of core processes this host window has spawned, including this one. */
	core_spawn_ordinal?: number
	core_spawn_reason?: CoreSpawnReason
	/** Exit code of the core this one replaced; only on the spawn right after an unexpected exit. */
	core_prev_exit_code?: number
	/** How long that core ran, in whole seconds. */
	core_prev_uptime_s?: number
}

export function getCoreSpawnTelemetryMetadata(env: NodeJS.ProcessEnv = process.env): CoreSpawnTelemetryMetadata {
	const metadata: CoreSpawnTelemetryMetadata = {}
	const ordinal = parseInteger(env[CORE_SPAWN_ORDINAL_ENV])
	if (ordinal !== undefined && ordinal >= 1) {
		metadata.core_spawn_ordinal = ordinal
	}
	const reason = env[CORE_SPAWN_REASON_ENV]
	if (isCoreSpawnReason(reason)) {
		metadata.core_spawn_reason = reason
	}
	// Any integer: Windows reports NTSTATUS exits that the host sees as negative.
	const exitCode = parseInteger(env[CORE_PREV_EXIT_CODE_ENV])
	if (exitCode !== undefined) {
		metadata.core_prev_exit_code = exitCode
	}
	const uptime = parseInteger(env[CORE_PREV_UPTIME_S_ENV])
	if (uptime !== undefined && uptime >= 0) {
		metadata.core_prev_uptime_s = uptime
	}
	return metadata
}

function parseInteger(value: string | undefined): number | undefined {
	if (value === undefined || value === "") {
		return undefined
	}
	const parsed = Number(value)
	return Number.isInteger(parsed) ? parsed : undefined
}

function isCoreSpawnReason(value: string | undefined): value is CoreSpawnReason {
	return value !== undefined && (CORE_SPAWN_REASONS as readonly string[]).includes(value)
}
