import type { MonitorUpdatePayload } from "@shared/ExtensionMessage"

/** Parses a `say: "monitor_update"` message's JSON text; undefined when malformed. */
export function parseMonitorUpdate(text: string | undefined): MonitorUpdatePayload | undefined {
	if (!text) {
		return undefined
	}
	try {
		const parsed = JSON.parse(text) as Partial<MonitorUpdatePayload>
		if (typeof parsed.name !== "string" || !Array.isArray(parsed.lines)) {
			return undefined
		}
		return {
			name: parsed.name,
			description: typeof parsed.description === "string" ? parsed.description : "",
			lines: parsed.lines.filter((line): line is string => typeof line === "string"),
			droppedLines: typeof parsed.droppedLines === "number" ? parsed.droppedLines : undefined,
			exit: parsed.exit,
		}
	} catch {
		return undefined
	}
}

/** Terminal line for a monitor card; mirrors the CLI wording. */
export function formatMonitorUpdateExit(exit: NonNullable<MonitorUpdatePayload["exit"]>): string {
	switch (exit.status) {
		case "stopped":
			return exit.stoppedBy === "user" ? "stopped by you" : "stopped"
		case "failed":
			return exit.error ? `failed: ${exit.error}` : "failed"
		default:
			return exit.code !== undefined && exit.code !== null ? `ended with exit code ${exit.code}` : "ended"
	}
}
