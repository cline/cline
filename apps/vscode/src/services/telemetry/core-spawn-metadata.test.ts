import { describe, expect, it } from "bun:test"
import {
	CORE_SPAWN_ORDINAL_ENV,
	CORE_SPAWN_REASON_ENV,
	getCoreSpawnTelemetryMetadata,
	HOST_IDE_MODE_ENV,
	HOST_IN_WSL_ENV,
	HOST_TERMINAL_SHELL_KIND_ENV,
	HOST_WORKSPACE_PATH_KIND_ENV,
} from "./core-spawn-metadata"

describe("core spawn telemetry metadata", () => {
	it("reports ordinal and reason from the host's spawn env", () => {
		expect(
			getCoreSpawnTelemetryMetadata({ [CORE_SPAWN_ORDINAL_ENV]: "3", [CORE_SPAWN_REASON_ENV]: "crash_restart" }),
		).toEqual({ core_spawn_ordinal: 3, core_spawn_reason: "crash_restart" })
	})

	it("reports the host facts the JetBrains plugin states at spawn", () => {
		expect(
			getCoreSpawnTelemetryMetadata({
				[HOST_WORKSPACE_PATH_KIND_ENV]: "wsl",
				[HOST_TERMINAL_SHELL_KIND_ENV]: "powershell",
				[HOST_IDE_MODE_ENV]: "remote_dev_host",
				[HOST_IN_WSL_ENV]: "true",
			}),
		).toEqual({
			host_workspace_path_kind: "wsl",
			host_terminal_shell_kind: "powershell",
			host_ide_mode: "remote_dev_host",
			host_in_wsl: true,
		})
		expect(getCoreSpawnTelemetryMetadata({ [HOST_IN_WSL_ENV]: "false" })).toEqual({ host_in_wsl: false })
	})

	it("drops host facts outside the allowlists so a host typo never becomes a bucket", () => {
		expect(
			getCoreSpawnTelemetryMetadata({
				[HOST_WORKSPACE_PATH_KIND_ENV]: "\\\\wsl$\\Ubuntu",
				[HOST_TERMINAL_SHELL_KIND_ENV]: "WSL",
				[HOST_IDE_MODE_ENV]: "",
				[HOST_IN_WSL_ENV]: "1",
			}),
		).toEqual({})
	})

	it("omits everything when the host set nothing, as in-process VS Code does", () => {
		expect(getCoreSpawnTelemetryMetadata({})).toEqual({})
	})

	it("drops malformed values independently of each other", () => {
		expect(
			getCoreSpawnTelemetryMetadata({ [CORE_SPAWN_ORDINAL_ENV]: "0", [CORE_SPAWN_REASON_ENV]: "crash_restart" }),
		).toEqual({
			core_spawn_reason: "crash_restart",
		})
		expect(getCoreSpawnTelemetryMetadata({ [CORE_SPAWN_ORDINAL_ENV]: "2", [CORE_SPAWN_REASON_ENV]: "because" })).toEqual({
			core_spawn_ordinal: 2,
		})
		expect(getCoreSpawnTelemetryMetadata({ [CORE_SPAWN_ORDINAL_ENV]: "1.5" })).toEqual({})
		expect(getCoreSpawnTelemetryMetadata({ [CORE_SPAWN_ORDINAL_ENV]: "" })).toEqual({})
	})
})
