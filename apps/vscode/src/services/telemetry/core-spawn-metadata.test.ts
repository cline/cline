import { describe, expect, it } from "bun:test"
import {
	CORE_PREV_EXIT_CODE_ENV,
	CORE_PREV_UPTIME_S_ENV,
	CORE_SPAWN_ORDINAL_ENV,
	CORE_SPAWN_REASON_ENV,
	getCoreSpawnTelemetryMetadata,
} from "./core-spawn-metadata"

describe("core spawn telemetry metadata", () => {
	it("reports ordinal and reason from the host's spawn env", () => {
		expect(
			getCoreSpawnTelemetryMetadata({ [CORE_SPAWN_ORDINAL_ENV]: "3", [CORE_SPAWN_REASON_ENV]: "crash_restart" }),
		).toEqual({ core_spawn_ordinal: 3, core_spawn_reason: "crash_restart" })
	})

	it("reports how the previous core died when the host passes it", () => {
		expect(
			getCoreSpawnTelemetryMetadata({
				[CORE_SPAWN_ORDINAL_ENV]: "2",
				[CORE_SPAWN_REASON_ENV]: "crash_restart",
				[CORE_PREV_EXIT_CODE_ENV]: "134",
				[CORE_PREV_UPTIME_S_ENV]: "123",
			}),
		).toEqual({
			core_spawn_ordinal: 2,
			core_spawn_reason: "crash_restart",
			core_prev_exit_code: 134,
			core_prev_uptime_s: 123,
		})
		// Windows NTSTATUS exits reach the host as negative numbers; they are still exit codes.
		expect(getCoreSpawnTelemetryMetadata({ [CORE_PREV_EXIT_CODE_ENV]: "-1073740791" })).toEqual({
			core_prev_exit_code: -1073740791,
		})
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
		expect(getCoreSpawnTelemetryMetadata({ [CORE_PREV_EXIT_CODE_ENV]: "abort", [CORE_PREV_UPTIME_S_ENV]: "-5" })).toEqual({})
		expect(getCoreSpawnTelemetryMetadata({ [CORE_PREV_EXIT_CODE_ENV]: "1", [CORE_PREV_UPTIME_S_ENV]: "2.5" })).toEqual({
			core_prev_exit_code: 1,
		})
	})
})
