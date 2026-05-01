// @jsxImportSource @opentui/react

import type { SessionHistoryRecord } from "@clinebot/core";
import {
	formatDisplayUserInput,
	formatHumanReadableDate,
	truncateStr,
} from "@clinebot/shared";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listSessions } from "../../session/session";
import { formatUsd } from "../../utils/output";
import { palette } from "../palette";

function hasForkMetadata(row: SessionHistoryRecord): boolean {
	const fork = row.metadata?.fork;
	return typeof fork === "object" && fork !== null && !Array.isArray(fork);
}

function formatTitle(row: SessionHistoryRecord, maxLen: number): string {
	const raw = row.metadata?.title?.trim() || row.prompt?.trim() || "Untitled";
	const forkTitle =
		hasForkMetadata(row) && !raw.endsWith(" (fork)") ? `${raw} (fork)` : raw;
	const normalized = formatDisplayUserInput(forkTitle);
	return truncateStr(normalized.replace(/\s+/g, " "), maxLen);
}

function formatRelativeDate(dateStr: string): string {
	const date = new Date(dateStr);
	if (Number.isNaN(date.getTime())) return dateStr;
	const now = Date.now();
	const diffMs = now - date.getTime();
	const diffMins = Math.floor(diffMs / 60_000);
	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) return `${diffDays}d ago`;
	if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
	return formatHumanReadableDate(dateStr);
}

const MAX_VISIBLE = 12;

type HistoryListActions = {
	onResolve: (sessionId: string) => void;
	onDismiss: () => void;
	onExport?: (sessionId: string) => Promise<string | undefined>;
	onDelete?: (sessionId: string) => Promise<boolean>;
};

type HistoryKeyEvent = {
	name?: string;
	ctrl?: boolean;
	shift?: boolean;
};

type HistoryListContentProps = HistoryListActions & {
	initialRows?: SessionHistoryRecord[];
	emptyMessage?: string;
	footerText?: string;
	title?: string;
	loadRows?: boolean;
	registerKeyHandler?: (
		handler: (key: HistoryKeyEvent | undefined) => void,
	) => void;
};

function HistoryListContent({
	initialRows,
	onResolve,
	onDismiss,
	onExport,
	onDelete,
	emptyMessage = "No sessions found",
	footerText = "\u2191/\u2193 navigate, Enter to resume, Esc to close",
	title = "Session History",
	loadRows = false,
	registerKeyHandler,
}: HistoryListContentProps) {
	const { width } = useTerminalDimensions();
	const [rows, setRows] = useState<SessionHistoryRecord[]>(
		() => initialRows ?? [],
	);
	const [selected, setSelected] = useState(0);
	const [loading, setLoading] = useState(loadRows);
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const handlerRef = useRef<(key: HistoryKeyEvent | undefined) => void>(
		() => {},
	);

	useEffect(() => {
		if (!loadRows) {
			setRows(initialRows ?? []);
			setLoading(false);
			return;
		}

		listSessions(50, { hydrate: true })
			.then((r) => setRows(r))
			.catch(() => {})
			.finally(() => setLoading(false));
	}, [initialRows, loadRows]);

	const safeSelected = Math.min(selected, Math.max(0, rows.length - 1));
	const titleMaxLen = Math.max(20, width - 30);

	const rowsRef = useRef(rows);
	rowsRef.current = rows;
	const selectedRef = useRef(safeSelected);
	selectedRef.current = safeSelected;

	const window = useMemo(() => {
		if (rows.length <= MAX_VISIBLE) {
			return { items: rows, startIndex: 0 };
		}
		const half = Math.floor(MAX_VISIBLE / 2);
		let start = Math.max(0, safeSelected - half);
		const end = Math.min(rows.length, start + MAX_VISIBLE);
		if (end - start < MAX_VISIBLE) start = Math.max(0, end - MAX_VISIBLE);
		return { items: rows.slice(start, end), startIndex: start };
	}, [rows, safeSelected]);

	handlerRef.current = (key: HistoryKeyEvent | undefined) => {
		if (!key) {
			return;
		}
		if (key.ctrl && key.name === "c") {
			onDismiss();
			return;
		}
		if (confirmDelete) {
			if (key.name === "y" || (key.shift && key.name === "y")) {
				const sessionId = confirmDelete;
				setConfirmDelete(null);
				setStatusMessage(`Deleting ${sessionId}...`);
				void onDelete?.(sessionId)
					.then((deleted) => {
						if (!deleted) {
							setStatusMessage(`Session ${sessionId} not found`);
							return;
						}
						setRows((currentRows) => {
							const nextRows = currentRows.filter(
								(row) => row.sessionId !== sessionId,
							);
							setSelected((currentSelected) =>
								Math.min(currentSelected, Math.max(0, nextRows.length - 1)),
							);
							return nextRows;
						});
						setStatusMessage(`Deleted ${sessionId}`);
					})
					.catch((error) => {
						setStatusMessage(
							error instanceof Error ? error.message : String(error),
						);
					});
			} else {
				setConfirmDelete(null);
			}
			return;
		}

		if (key.name === "escape") {
			onDismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			const currentRows = rowsRef.current;
			const row = currentRows[selectedRef.current];
			if (row) onResolve(row.sessionId);
			return;
		}
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			setStatusMessage(null);
			setSelected((s) => {
				const len = rowsRef.current.length;
				return s <= 0 ? len - 1 : s - 1;
			});
			return;
		}
		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			setStatusMessage(null);
			setSelected((s) => {
				const len = rowsRef.current.length;
				return s >= len - 1 ? 0 : s + 1;
			});
			return;
		}
		if (key.name === "left") {
			const row = rowsRef.current[selectedRef.current];
			if (row?.sessionId && onDelete) {
				setConfirmDelete(row.sessionId);
			}
			return;
		}
		if (key.name === "right") {
			const row = rowsRef.current[selectedRef.current];
			if (row?.sessionId && onExport) {
				setStatusMessage(`Exporting ${row.sessionId}...`);
				void onExport(row.sessionId)
					.then((path) => {
						setStatusMessage(
							path
								? `Exported ${row.sessionId} to ${path}`
								: `Exported ${row.sessionId}`,
						);
					})
					.catch((error) => {
						setStatusMessage(
							error instanceof Error ? error.message : String(error),
						);
					});
			}
		}
	};

	useEffect(() => {
		registerKeyHandler?.((key) => handlerRef.current(key));
	}, [registerKeyHandler]);

	if (loading) {
		return (
			<box flexDirection="column" paddingX={1}>
				<text fg="gray">Loading session history...</text>
			</box>
		);
	}

	if (rows.length === 0) {
		return (
			<box flexDirection="column" paddingX={1} gap={1}>
				<text>{title}</text>
				<text fg="gray">{emptyMessage}</text>
				<text fg="gray">
					<em>Esc to close</em>
				</text>
			</box>
		);
	}

	const aboveCount = window.startIndex;
	const belowCount = rows.length - window.startIndex - window.items.length;

	return (
		<box flexDirection="column" paddingX={1}>
			<text fg={confirmDelete ? "red" : undefined}>
				{confirmDelete ? "Delete this session? (y/n)" : title}
			</text>

			<box flexDirection="column" marginTop={1}>
				{aboveCount > 0 && (
					<text fg="gray">
						{"\u25b2 "}
						{aboveCount} more
					</text>
				)}

				{window.items.map((row, i) => {
					const absIdx = window.startIndex + i;
					const isSel = absIdx === safeSelected;
					const cost = row.metadata?.totalCost;
					const title = formatTitle(row, titleMaxLen);
					const date = formatRelativeDate(row.startedAt);

					return (
						<box
							key={row.sessionId}
							flexDirection="row"
							paddingX={1}
							backgroundColor={isSel ? palette.selection : undefined}
							onMouseDown={() => onResolve(row.sessionId)}
							overflow="hidden"
							height={1}
						>
							<text
								fg={isSel ? palette.textOnSelection : "gray"}
								flexShrink={0}
							>
								{isSel ? "\u276f " : "  "}
							</text>
							<text
								fg={isSel ? palette.textOnSelection : undefined}
								flexGrow={1}
							>
								{title}
							</text>
							{cost != null && cost > 0 && (
								<text
									fg={isSel ? palette.textOnSelection : "gray"}
									flexShrink={0}
								>
									{"  "}
									{formatUsd(cost, 2)}
								</text>
							)}
							<text
								fg={isSel ? palette.textOnSelection : "gray"}
								flexShrink={0}
							>
								{"  "}
								{date}
							</text>
						</box>
					);
				})}

				{belowCount > 0 && (
					<text fg="gray">
						{"\u25bc "}
						{belowCount} more
					</text>
				)}
			</box>

			{statusMessage && (
				<text
					fg={
						statusMessage.startsWith("Exported") ||
						statusMessage.startsWith("Exporting") ||
						statusMessage.startsWith("Deleted") ||
						statusMessage.startsWith("Deleting")
							? palette.success
							: "red"
					}
					marginTop={1}
				>
					{statusMessage}
				</text>
			)}

			<text fg="gray" marginTop={1}>
				<em>{footerText}</em>
			</text>
		</box>
	);
}

export function HistoryDialogContent(props: ChoiceContext<string>) {
	const { resolve, dismiss, dialogId } = props;
	const [keyHandler, setKeyHandler] = useState<
		((key: HistoryKeyEvent | undefined) => void) | undefined
	>();
	const registerKeyHandler = useCallback(
		(handler: (key: HistoryKeyEvent | undefined) => void) => {
			setKeyHandler(() => handler);
		},
		[],
	);

	useDialogKeyboard((key) => keyHandler?.(key), dialogId);

	return (
		<HistoryListContent
			loadRows
			onResolve={resolve}
			onDismiss={dismiss}
			registerKeyHandler={registerKeyHandler}
		/>
	);
}

export function HistoryStandaloneContent(
	props: HistoryListActions & {
		rows: SessionHistoryRecord[];
		title?: string;
		footerText?: string;
	},
) {
	const [keyHandler, setKeyHandler] = useState<
		((key: HistoryKeyEvent | undefined) => void) | undefined
	>();
	const registerKeyHandler = useCallback(
		(handler: (key: HistoryKeyEvent | undefined) => void) => {
			setKeyHandler(() => handler);
		},
		[],
	);

	useKeyboard((key) => keyHandler?.(key));

	return (
		<HistoryListContent
			initialRows={props.rows}
			onResolve={props.onResolve}
			onDismiss={props.onDismiss}
			onExport={props.onExport}
			onDelete={props.onDelete}
			title={props.title ?? "History"}
			footerText={
				props.footerText ??
				"\u2191/\u2193 navigate, Enter to resume, \u2190 delete, \u2192 export, Esc to close"
			}
			registerKeyHandler={registerKeyHandler}
		/>
	);
}
