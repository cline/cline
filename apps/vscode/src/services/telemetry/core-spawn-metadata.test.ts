import { describe, expect, it } from "bun:test"
import { CORE_SPAWN_ORDINAL_ENV, CORE_SPAWN_REASON_ENV, getCoreSpawnTelemetryMetadata } from "./core-spawn-metadata"

describe("core spawn telemetry metadata", () => {
	it("reports ordinal and reason from the host's spawn env", () => {
		expect(
			getCoreSpawnTelemetryMetadata({ [CORE_SPAWN_ORDINAL_ENV]: "3", [CORE_SPAWN_REASON_ENV]: "crash_restart" }),
		).toEqual({ core_spawn_ordinal: 3, core_spawn_reason: "crash_restart" })
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
