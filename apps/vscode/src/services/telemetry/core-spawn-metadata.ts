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
 * The host facts answer what `os_type` cannot: a Windows IDE editing a project
 * on a `\\wsl$\` share, an IDE terminal that opens `wsl.exe`, a Remote
 * Development backend or thin client, and a Linux IDE that itself runs inside
 * WSL behind Gateway all looked like plain local installs before.
 */
import {
	CORE_SPAWN_REASONS,
	type CoreSpawnReason,
	HOST_IDE_MODES,
	HOST_TERMINAL_SHELL_KINDS,
	HOST_WORKSPACE_PATH_KINDS,
	type HostIdeMode,
	type HostTerminalShellKind,
	type HostWorkspacePathKind,
} from "@cline/shared"

export const CORE_SPAWN_ORDINAL_ENV = "CLINE_CORE_SPAWN_ORDINAL"
export const CORE_SPAWN_REASON_ENV = "CLINE_CORE_SPAWN_REASON"
export const HOST_WORKSPACE_PATH_KIND_ENV = "CLINE_HOST_WORKSPACE_PATH_KIND"
export const HOST_TERMINAL_SHELL_KIND_ENV = "CLINE_HOST_TERMINAL_SHELL_KIND"
export const HOST_IDE_MODE_ENV = "CLINE_HOST_IDE_MODE"
export const HOST_IN_WSL_ENV = "CLINE_HOST_IN_WSL"

export { CORE_SPAWN_REASONS, type CoreSpawnReason }

export type CoreSpawnTelemetryMetadata = {
	/** 1-based count of core processes this host window has spawned, including this one. */
	core_spawn_ordinal?: number
	core_spawn_reason?: CoreSpawnReason
	/** Where the project lives: a local disk, a `\\wsl$\` share, or another UNC share. */
	host_workspace_path_kind?: HostWorkspacePathKind
	/** The shell the IDE's own terminal is configured to open. */
	host_terminal_shell_kind?: HostTerminalShellKind
	/** Which Remote Development process this plugin runs in, if any. */
	host_ide_mode?: HostIdeMode
	/** The IDE process itself runs inside a WSL distro. */
	host_in_wsl?: boolean
}

export function getCoreSpawnTelemetryMetadata(env: NodeJS.ProcessEnv = process.env): CoreSpawnTelemetryMetadata {
	const metadata: CoreSpawnTelemetryMetadata = {}
	const ordinal = Number(env[CORE_SPAWN_ORDINAL_ENV])
	if (Number.isInteger(ordinal) && ordinal >= 1) {
		metadata.core_spawn_ordinal = ordinal
	}
	const reason = oneOf(CORE_SPAWN_REASONS, env[CORE_SPAWN_REASON_ENV])
	if (reason !== undefined) {
		metadata.core_spawn_reason = reason
	}
	const workspacePathKind = oneOf(HOST_WORKSPACE_PATH_KINDS, env[HOST_WORKSPACE_PATH_KIND_ENV])
	if (workspacePathKind !== undefined) {
		metadata.host_workspace_path_kind = workspacePathKind
	}
	const terminalShellKind = oneOf(HOST_TERMINAL_SHELL_KINDS, env[HOST_TERMINAL_SHELL_KIND_ENV])
	if (terminalShellKind !== undefined) {
		metadata.host_terminal_shell_kind = terminalShellKind
	}
	const ideMode = oneOf(HOST_IDE_MODES, env[HOST_IDE_MODE_ENV])
	if (ideMode !== undefined) {
		metadata.host_ide_mode = ideMode
	}
	const inWsl = env[HOST_IN_WSL_ENV]
	if (inWsl === "true" || inWsl === "false") {
		metadata.host_in_wsl = inWsl === "true"
	}
	return metadata
}

/** The value when it is one of the allowed wire names, so a host typo never becomes a new bucket. */
function oneOf<T extends string>(allowed: readonly T[], value: string | undefined): T | undefined {
	return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}
