import { appendFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const SDK_START_TIMING_LOG_PATH =
	process.env.CLINE_SDK_START_TIMING_LOG ?? join(tmpdir(), "cline-sdk-session-start-timing-after.log")

export function nowMs(): number {
	return Number(process.hrtime.bigint()) / 1_000_000
}

export function logSdkStartTiming(event: string, fields: Record<string, unknown> = {}): void {
	const record = {
		ts: new Date().toISOString(),
		pid: process.pid,
		event,
		...fields,
	}

	appendFile(SDK_START_TIMING_LOG_PATH, `${JSON.stringify(record)}\n`).catch(() => {
		// Best-effort perf instrumentation only.
	})
}
