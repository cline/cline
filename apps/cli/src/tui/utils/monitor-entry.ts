import type { ChatEntry } from "../types";

export type MonitorUpdateEntry = Extract<ChatEntry, { kind: "monitor_update" }>;

/** Terminal line for a monitor card; absent while the monitor still runs. */
export function formatMonitorExitLine(
	exit: MonitorUpdateEntry["exit"],
): string | undefined {
	if (!exit) return undefined;
	switch (exit.status) {
		case "stopped":
			return exit.stoppedBy === "user" ? "stopped by you" : "stopped";
		case "failed":
			return exit.error ? `failed: ${exit.error}` : "failed";
		default:
			if (exit.code !== undefined && exit.code !== null) {
				return `ended with exit code ${exit.code}`;
			}
			return exit.signal ? `ended on signal ${exit.signal}` : "ended";
	}
}
