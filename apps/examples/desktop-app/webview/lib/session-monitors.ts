export type SessionMonitor = {
	id: string;
	name: string;
};

/**
 * Shape of the registry's MonitorRecord as delivered through the sidecar's
 * monitor_state events and the list_monitors command. Only the fields the
 * header consumes are read; everything else passes through untouched.
 */
export type SessionMonitorRecord = {
	id?: unknown;
	name?: unknown;
	status?: unknown;
};

/**
 * Projects a registry snapshot onto the header roster: running monitors only,
 * validated field by field since snapshots cross the sidecar's JSON boundary.
 *
 * The roster is deliberately not reconstructed from transcript text. The
 * registry is the owner of monitor lifecycle; snapshots arrive on every
 * change (start, exit, stop, disposal), so the transcript-parsing layer this
 * replaced — and its false positives from quoted markers — is unnecessary.
 */
export function runningMonitors(
	records: readonly SessionMonitorRecord[] | undefined,
): SessionMonitor[] {
	if (!Array.isArray(records)) return [];
	const monitors: SessionMonitor[] = [];
	for (const record of records) {
		if (record?.status !== "running") continue;
		const id = typeof record.id === "string" ? record.id : "";
		const name = typeof record.name === "string" ? record.name : "";
		if (!id || !name) continue;
		monitors.push({ id, name });
	}
	return monitors;
}
