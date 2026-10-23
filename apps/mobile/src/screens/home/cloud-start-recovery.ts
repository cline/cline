import type { CloudStartJob } from "@/state/cloud-starts";
import { cloudRepositoryLabel, type SessionRow } from "./session-rows";

/**
 * An unknown create may be resumed only through the failed job that owns the
 * retained submission. Account scope and repository are the minimum safe match;
 * the final choice still belongs to the person inspecting the session list.
 */
export function isCloudStartRecoveryCandidate(
	job: CloudStartJob,
	row: SessionRow,
): boolean {
	if (
		job.phase !== "error" ||
		job.recovery !== "check-sessions" ||
		row.kind !== "session" ||
		row.descriptor.mode !== "cloud" ||
		!row.descriptor.remoteSessionId ||
		(row.status !== undefined &&
			["expired", "failed", "stopped"].includes(row.status))
	) {
		return false;
	}
	if (
		(job.target.organizationId ?? undefined) !==
		(row.descriptor.organizationId ?? undefined)
	) {
		return false;
	}
	return (
		row.location.kind === "cloud" &&
		normalizeLocation(row.location.name) ===
			normalizeLocation(cloudRepositoryLabel(job.target.repoUrl))
	);
}

function normalizeLocation(value: string): string {
	return value
		.trim()
		.replace(/\.git$/i, "")
		.toLowerCase();
}
