import type { SessionHistoryRecord } from "@clinebot/core";
import {
	formatDisplayUserInput,
	formatHumanReadableDate,
	truncateStr,
} from "@clinebot/shared";
import { Box, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";
import { deleteSession } from "../../session/session";
import { formatUsd } from "../../utils/output";

function formatHistoryTitle(
	title: string | undefined,
	prompt: string | undefined,
): string | undefined {
	const rawTitle = title?.trim() || prompt?.trim() || undefined;
	if (!rawTitle) return;
	const normalized = formatDisplayUserInput(rawTitle);
	return truncateStr(normalized.replace(/\s+/g, " "), 40);
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
		return `CP${count}R${latestRun}`;
	}
	return `CP${count}`;
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
			? formatHumanReadableDate(new Date(latest.createdAt).toISOString())
			: "unknown";
	const latestRun =
		typeof latest.runCount === "number" && Number.isFinite(latest.runCount)
			? ` run ${latest.runCount}`
			: "";
	return `Checkpoint ${shortRef}${latestRun} created ${created}. ${count} total.`;
}

export function formatHistoryListLine(row: SessionHistoryRecord): string {
	const title = formatHistoryTitle(row.metadata?.title, row.prompt);
	if (!title) return "";
	const cost = formatUsd(row.metadata?.totalCost ?? 0, 2);
	const provider = truncateStr(row.provider?.trim() || "unknown", 20);
	const model = truncateStr(row.model?.trim() || "", 28);

	const checkpointCreatedAt = row.metadata?.checkpoint?.latest?.createdAt;
	const timestamp =
		typeof checkpointCreatedAt === "number" &&
		Number.isFinite(checkpointCreatedAt)
			? checkpointCreatedAt
			: new Date(row.startedAt).getTime();
	const date = new Date(timestamp);

	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const year = date.getUTCFullYear();
	const hour = String(date.getUTCHours()).padStart(2, "0");
	const minute = String(date.getUTCMinutes()).padStart(2, "0");
	const dateStr = `${month}/${day}/${year}`;
	const timeStr = `${hour}:${minute}`;
	return `${dateStr} ${timeStr} ${provider}:${model} | ${cost} | ${title}`;
}

export interface HistoryListViewProps {
	rows: SessionHistoryRecord[];
	onSelect: (sessionId: string) => void;
	onExport?: (sessionId: string) => Promise<string | undefined>;
	onExit: () => void;
}

export function HistoryListView({
	rows: initialRows,
	onSelect,
	onExport,
	onExit,
}: HistoryListViewProps) {
	const [rows, setRows] = useState(initialRows);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const pageSize = Math.max(1, (process.stdout.rows ?? 24) / 4); // Leave room for header and footer
	const selectedRow = rows[selectedIndex];
	const checkpointDetail = selectedRow
		? formatCheckpointDetail(selectedRow)
		: undefined;

	const visibleWindow = useMemo(() => {
		const start = Math.max(0, selectedIndex - Math.floor(pageSize / 2));
		const end = Math.min(rows.length, start + pageSize);
		const adjustedStart = Math.max(0, end - pageSize);
		return {
			items: rows.slice(adjustedStart, end),
			startIndex: adjustedStart,
		};
	}, [rows, selectedIndex, pageSize]);

	useInput((input, key) => {
		if (confirmDelete !== null) {
			if (input === "y" || input === "Y") {
				const sessionId = confirmDelete;
				setConfirmDelete(null);
				deleteSession(sessionId)
					.then(() => {
						setRows((prev) => {
							const next = prev.filter((r) => r.sessionId !== sessionId);
							setSelectedIndex((idx) =>
								Math.min(idx, Math.max(0, next.length - 1)),
							);
							return next;
						});
					})
					.catch(() =>
						// Ignore errors, just close the confirm dialog
						setConfirmDelete(null),
					);
			} else {
				setConfirmDelete(null);
			}
			return;
		}

		if (key.upArrow) {
			setStatusMessage(null);
			setSelectedIndex((prev) => (prev > 0 ? prev - 1 : rows.length - 1));
		} else if (key.downArrow) {
			setStatusMessage(null);
			setSelectedIndex((prev) => (prev < rows.length - 1 ? prev + 1 : 0));
		} else if (key.rightArrow && onExport) {
			const selected = rows[selectedIndex];
			if (selected?.sessionId) {
				setStatusMessage(`Exporting ${selected.sessionId}...`);
				void onExport(selected.sessionId)
					.then((path) => {
						setStatusMessage(
							path
								? `Exported ${selected.sessionId} to ${path}`
								: `Exported ${selected.sessionId}`,
						);
					})
					.catch((error) => {
						setStatusMessage(
							error instanceof Error ? error.message : String(error),
						);
					});
			}
		} else if (key.leftArrow) {
			const selected = rows[selectedIndex];
			if (selected?.sessionId) {
				setConfirmDelete(selected.sessionId);
			}
		} else if (key.return) {
			const selected = rows[selectedIndex];
			if (selected?.sessionId) {
				onSelect(selected.sessionId);
			}
		} else if (key.escape || (key.ctrl && input === "c")) {
			onExit();
		}
	});

	const headerText = confirmDelete
		? `Delete this session? (y/n)`
		: "History (Up/Down to navigate | Enter to resume | Esc to quit)";
	const headerColor = confirmDelete ? "red" : "cyan";
	const footerText =
		rows.length > pageSize
			? `Showing ${visibleWindow.startIndex + 1}-${Math.min(visibleWindow.startIndex + pageSize, rows.length)} of ${rows.length} | \u2190 delete | \u2192 export`
			: `\u2190 delete | \u2192 export`;

	return React.createElement(
		Box,
		{ flexDirection: "column", padding: 1 },
		React.createElement(Text, { bold: true, color: headerColor }, headerText),
		React.createElement(
			Box,
			{ flexDirection: "column", marginTop: 1 },
			visibleWindow.items
				.filter((row) => !!row.prompt?.trim())
				.map((row, index) => {
					const absoluteIndex = visibleWindow.startIndex + index;
					const isSelected = absoluteIndex === selectedIndex;
					const checkpointBadge = formatCheckpointBadge(row);
					return React.createElement(
						Text,
						{
							key: row.sessionId || absoluteIndex,
							color: isSelected ? (confirmDelete ? "red" : "blue") : undefined,
							inverse: isSelected,
						},
						`${isSelected ? "❯" : " "} ${formatHistoryListLine(row)}`,
						checkpointBadge
							? React.createElement(
									Text,
									{
										color: isSelected ? "yellow" : "gray",
										inverse: false,
									},
									`[${checkpointBadge}]`,
								)
							: undefined,
					);
				}),
		),
		checkpointDetail
			? React.createElement(
					Text,
					{ color: "gray", dimColor: true },
					`\n${checkpointDetail}`,
				)
			: undefined,
		statusMessage
			? React.createElement(
					Text,
					{
						color:
							statusMessage.startsWith("Exported") ||
							statusMessage.startsWith("Exporting")
								? "green"
								: "red",
					},
					`\n${statusMessage}`,
				)
			: undefined,
		React.createElement(Text, { color: "gray" }, `\n${footerText}`),
	);
}
