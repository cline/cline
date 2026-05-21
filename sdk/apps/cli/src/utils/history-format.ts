import type { SessionHistoryRecord } from "@cline/core";
import { formatDisplayUserInput, truncateStr } from "@cline/shared";
import { formatUsd } from "./output";
import { shouldShowCliUsageCost } from "./usage-cost-display";

export function formatSessionStatusLabel(
	status: SessionHistoryRecord["status"] | undefined,
): string {
	return status?.trim() || "unknown";
}

export function mergeHistoryStatusRows(
	currentRows: SessionHistoryRecord[],
	refreshedRows: SessionHistoryRecord[],
): SessionHistoryRecord[] {
	const currentById = new Map(
		currentRows.map((row) => [row.sessionId, row] as const),
	);

	return refreshedRows.map((row) => {
		const current = currentById.get(row.sessionId);
		if (!current) {
			return row;
		}
		return {
			...current,
			status: row.status,
			endedAt: row.endedAt,
			exitCode: row.exitCode,
			updatedAt: row.updatedAt,
		};
	});
}

function formatHistoryTitle(
	title: string | undefined,
	prompt: string | undefined,
): string | undefined {
	const rawTitle = title?.trim() || prompt?.trim() || undefined;
	if (!rawTitle) return;
	const normalized = formatDisplayUserInput(rawTitle);
	return truncateStr(normalized.replace(/\s+/g, " "), 40);
}

export function isFileBasedCronSession(row: SessionHistoryRecord): boolean {
	const cron = row.metadata?.cron;
	if (!cron || typeof cron !== "object") return false;
	const specPath = (cron as { specPath?: unknown }).specPath;
	return typeof specPath === "string" && specPath.length > 0;
}

export function fileBasedCronPrefix(
	row: SessionHistoryRecord,
): string | undefined {
	if (!isFileBasedCronSession(row)) return undefined;
	const specPath = (row.metadata?.cron as { specPath?: string }).specPath;
	const base = specPath ? specPath.split("/").pop() : undefined;
	return base ? `[file-based: ${base}] ` : "[file-based] ";
}

export function formatCheckpointBadge(
	row: SessionHistoryRecord,
): string | undefined {
	const checkpoint = row.metadata?.checkpoint;
	const count = checkpoint?.history?.length ?? 0;
	const latestRun = checkpoint?.latest?.runCount;
	if (count <= 0) {
		return undefined;
	}
	if (typeof latestRun === "number" && Number.isFinite(latestRun)) {
		return `CP ${count} R${latestRun}`;
	}
	return `CP ${count}`;
}

export function formatCheckpointDetail(
	row: SessionHistoryRecord,
): string | undefined {
	const checkpoint = row.metadata?.checkpoint;
	const count = checkpoint?.history?.length ?? 0;
	const latest = checkpoint?.latest;
	if (count <= 0 || !latest?.ref) {
		return undefined;
	}
	const shortRef = truncateStr(latest.ref, 12);
	const created =
		typeof latest.createdAt === "number" && Number.isFinite(latest.createdAt)
			? formatUtcDate(new Date(latest.createdAt))
			: "unknown";
	const latestRun =
		typeof latest.runCount === "number" && Number.isFinite(latest.runCount)
			? ` run ${latest.runCount}`
			: "";
	return `Checkpoint ${shortRef}${latestRun} created ${created}. ${count} total. Restore with: cline checkpoint restore latest --session-id ${row.sessionId}`;
}

function formatUtcDate(date: Date): string {
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const year = date.getUTCFullYear();
	const hour = String(date.getUTCHours()).padStart(2, "0");
	const minute = String(date.getUTCMinutes()).padStart(2, "0");
	return `${month}/${day}/${year} ${hour}:${minute}`;
}

export function formatHistoryListLine(row: SessionHistoryRecord): string {
	const title = formatHistoryTitle(row.metadata?.title, row.prompt);
	if (!title) return "";
	const cost = shouldShowCliUsageCost(row.provider)
		? formatUsd(row.metadata?.totalCost ?? 0, 2)
		: undefined;
	const provider = truncateStr(row.provider?.trim() || "unknown", 20);
	const model = truncateStr(row.model?.trim() || "", 28);

	const checkpointCreatedAt = row.metadata?.checkpoint?.latest?.createdAt;
	const timestamp =
		typeof checkpointCreatedAt === "number" &&
		Number.isFinite(checkpointCreatedAt)
			? checkpointCreatedAt
			: new Date(row.startedAt).getTime();
	const date = formatUtcDate(new Date(timestamp));
	const costSegment = cost ? ` | ${cost}` : "";
	const prefix = fileBasedCronPrefix(row) ?? "";
	return `${date} ${provider}:${model} [${formatSessionStatusLabel(row.status)}]${costSegment} | ${prefix}${title}`;
}
