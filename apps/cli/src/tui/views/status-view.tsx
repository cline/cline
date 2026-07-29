// @jsxImportSource @opentui/react

import {
	buildDependencyMap,
	type StatusState,
	type StatusSummary,
	type StatusUpdate,
	type TeamRuntimeState,
} from "@cline/shared";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { palette } from "../palette";
import type {
	StatusSnapshotSource,
	StatusViewBootstrap,
} from "../status/status-snapshot-source";

export type StatusLens = "board" | "dependency-map";

const BOARD_ORDER: StatusState[] = [
	"blocked",
	"failed",
	"running",
	"queued",
	"done",
	"cancelled",
];

function stateColor(state: StatusState): string {
	switch (state) {
		case "blocked":
			return palette.plan;
		case "failed":
			return palette.error;
		case "running":
			return palette.act;
		case "done":
			return palette.success;
		default:
			return palette.muted;
	}
}

type StatusKeyEvent = {
	name?: string;
	ctrl?: boolean;
	shift?: boolean;
};

function StatusHubContent({
	onDismiss,
	registerKeyHandler,
	source,
	bootstrap,
}: {
	onDismiss: () => void;
	registerKeyHandler?: (handler: (key: StatusKeyEvent | undefined) => void) => void;
	source: StatusSnapshotSource;
	bootstrap?: StatusViewBootstrap;
}) {
	const initialLens = bootstrap?.initialLens ?? "board";
	const banner = bootstrap?.banner;
	const { width, height } = useTerminalDimensions();
	const [lens, setLens] = useState<StatusLens>(initialLens);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [updates, setUpdates] = useState<StatusUpdate[]>([]);
	const [summary, setSummary] = useState<StatusSummary | null>(null);
	const [teams, setTeams] = useState<TeamRuntimeState[]>([]);
	const [selected, setSelected] = useState(0);
	const handlerRef = useRef<(key: StatusKeyEvent | undefined) => void>(() => {});

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const snap = await source.load();
				if (cancelled) return;
				setUpdates(snap.updates);
				setSummary(snap.summary);
				setTeams(snap.teams);
				setError(null);
			} catch (err) {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [source]);

	const graph = useMemo(() => buildDependencyMap(teams), [teams]);

	const boardRows = useMemo(() => {
		const byState = new Map<StatusState, StatusUpdate[]>();
		for (const state of BOARD_ORDER) byState.set(state, []);
		for (const update of updates) {
			const bucket = byState.get(update.state) ?? [];
			bucket.push(update);
			byState.set(update.state, bucket);
		}
		const rows: Array<
			| { kind: "heading"; state: StatusState; count: number }
			| { kind: "row"; update: StatusUpdate }
		> = [];
		for (const state of BOARD_ORDER) {
			const list = byState.get(state) ?? [];
			if (list.length === 0) continue;
			rows.push({ kind: "heading", state, count: list.length });
			for (const update of list) rows.push({ kind: "row", update });
		}
		return rows;
	}, [updates]);

	const selectableBoardIndexes = useMemo(
		() =>
			boardRows
				.map((row, index) => (row.kind === "row" ? index : -1))
				.filter((index) => index >= 0),
		[boardRows],
	);

	const maxVisible = Math.min(
		14,
		Math.max(8, Math.min(height - 14, 18)),
	);
	// Dialog is narrower than the full terminal; truncate for the content column.
	const titleWidth = Math.max(28, Math.min(width - 24, 88));

	useEffect(() => {
		if (lens !== "dependency-map" || graph.nodes.length === 0) {
			setSelected(0);
			return;
		}
		const interesting = graph.nodes.findIndex(
			(node) =>
				node.status === "blocked" ||
				(node.dependsOnKeys.length > 0 && node.dependentKeys.length > 0),
		);
		setSelected(interesting >= 0 ? interesting : 0);
	}, [graph.nodes, lens]);

	useEffect(() => {
		handlerRef.current = (key) => {
			if (!key?.name) return;
			if (key.name === "escape") {
				onDismiss();
				return;
			}
			if (key.name === "tab") {
				setLens((current) =>
					current === "board" ? "dependency-map" : "board",
				);
				return;
			}
			const count =
				lens === "board"
					? selectableBoardIndexes.length
					: graph.nodes.length;
			if (count === 0) return;
			if (key.name === "up" || (key.ctrl && key.name === "p")) {
				setSelected((i) => (i - 1 + count) % count);
				return;
			}
			if (key.name === "down" || (key.ctrl && key.name === "n")) {
				setSelected((i) => (i + 1) % count);
			}
		};
	}, [
		graph.nodes.length,
		lens,
		onDismiss,
		selectableBoardIndexes.length,
	]);

	useEffect(() => {
		registerKeyHandler?.((key) => handlerRef.current(key));
	}, [registerKeyHandler]);

	const selectedNode =
		lens === "dependency-map" ? graph.nodes[selected] : undefined;
	const selectedBoardRowIndex =
		lens === "board" ? selectableBoardIndexes[selected] : undefined;

	const mapWindowStart = useMemo(() => {
		if (graph.nodes.length <= maxVisible) return 0;
		const mid = Math.floor(maxVisible / 2);
		return Math.max(
			0,
			Math.min(selected - mid, graph.nodes.length - maxVisible),
		);
	}, [graph.nodes.length, maxVisible, selected]);
	const visibleMapNodes = graph.nodes.slice(
		mapWindowStart,
		mapWindowStart + maxVisible,
	);

	return (
		<box flexDirection="column" width="100%" paddingLeft={1} paddingRight={1}>
			<text>
				<span fg={palette.act}>Status Hub</span>
				<span fg={palette.muted}>
					{"  "}
					{lens === "board" ? "[Board]" : " Board "}
					{" / "}
					{lens === "dependency-map" ? "[Dependency map]" : " Dependency map "}
					{"  "}
					(Tab to switch)
				</span>
			</text>

			{summary ? (
				<text fg={palette.muted}>
					{summary.byState.blocked ?? 0} blocked ·{" "}
					{summary.byState.failed ?? 0} failed ·{" "}
					{summary.byState.running ?? 0} running ·{" "}
					{summary.total} live
				</text>
			) : banner ? (
				<text fg={palette.muted}>{banner}</text>
			) : (
				<text fg={palette.muted}>Live hub status</text>
			)}

			{loading ? (
				<text fg={palette.muted}>Loading status…</text>
			) : error ? (
				<text fg={palette.error}>{error}</text>
			) : lens === "board" ? (
				<box flexDirection="column" marginTop={1}>
					{boardRows.length === 0 ? (
						<text fg={palette.muted}>
							No status updates yet. Agents publish with report_status.
						</text>
					) : (
						boardRows.slice(0, maxVisible).map((row, index) => {
							if (row.kind === "heading") {
								return (
									<text key={`h-${row.state}`} fg={stateColor(row.state)}>
										{row.state.toUpperCase()} ({row.count})
									</text>
								);
							}
							const active = index === selectedBoardRowIndex;
							const line = `${row.update.headline} · ${row.update.agentName ?? "agent"} · ${row.update.subject}`;
							return (
								<text
									key={row.update.updateId}
									fg={active ? palette.selection : undefined}
								>
									{active ? "› " : "  "}
									{line.length > titleWidth
										? `${line.slice(0, titleWidth - 1)}…`
										: line}
								</text>
							);
						})
					)}
				</box>
			) : (
				<box flexDirection="column" marginTop={1}>
					{graph.nodes.length === 0 ? (
						<text fg={palette.muted}>
							No active team tasks. Dependency maps appear when a team session
							is live.
						</text>
					) : (
						<>
							<text fg={palette.muted}>
								{graph.nodes.length} tasks · {graph.counts.blocked} blocked ·{" "}
								{graph.nodes.filter((n) => n.isReady).length} ready
								{graph.nodes.length > maxVisible
									? ` · showing ${mapWindowStart + 1}–${mapWindowStart + visibleMapNodes.length}`
									: ""}
							</text>
							{visibleMapNodes.map((node, offset) => {
								const index = mapWindowStart + offset;
								const active = index === selected;
								const flags = [
									node.isReady ? "ready" : "",
									node.isWaiting ? "waiting" : "",
									node.inCycle ? "cycle" : "",
								]
									.filter(Boolean)
									.join(" ");
								const line = `${node.id}  ${node.status.replace("_", " ")}  L${node.layer}${flags ? `  ${flags}` : ""}  ${node.title}`;
								return (
									<text
										key={node.key}
										fg={active ? palette.selection : undefined}
									>
										{active ? "› " : "  "}
										{line.length > titleWidth
											? `${line.slice(0, titleWidth - 1)}…`
											: line}
									</text>
								);
							})}
							{selectedNode ? (
								<box marginTop={1} flexDirection="column">
									<text fg={palette.act}>
										{selectedNode.id} · {selectedNode.title}
									</text>
									<text fg={palette.muted}>
										Blocked by:{" "}
										{selectedNode.dependsOnKeys.length
											? selectedNode.dependsOnKeys
													.map(
														(key) =>
															graph.nodes.find((n) => n.key === key)?.id ??
															key,
													)
													.join(", ")
											: "—"}
									</text>
									<text fg={palette.muted}>
										Unblocks:{" "}
										{selectedNode.dependentKeys.length
											? selectedNode.dependentKeys
													.map(
														(key) =>
															graph.nodes.find((n) => n.key === key)?.id ??
															key,
													)
													.join(", ")
											: "—"}
									</text>
								</box>
							) : null}
						</>
					)}
				</box>
			)}

			<text fg={palette.muted} marginTop={1}>
				↑/↓ navigate · Tab switch lens · Esc close
			</text>
		</box>
	);
}

export function StatusDialogContent(
	props: ChoiceContext<void> & {
		source: StatusSnapshotSource;
		bootstrap?: StatusViewBootstrap;
	},
) {
	const { source, bootstrap, resolve, dialogId } = props;
	const keyHandlerRef = useRef<(key: StatusKeyEvent | undefined) => void>(
		() => {},
	);
	useDialogKeyboard((key) => {
		keyHandlerRef.current(key as StatusKeyEvent);
	}, dialogId);
	return (
		<StatusHubContent
			onDismiss={() => resolve(undefined)}
			registerKeyHandler={(handler) => {
				keyHandlerRef.current = handler;
			}}
			source={source}
			bootstrap={bootstrap}
		/>
	);
}

export function StatusStandaloneContent(props: {
	onDismiss: () => void;
	source: StatusSnapshotSource;
	bootstrap?: StatusViewBootstrap;
}) {
	const keyHandlerRef = useRef<(key: StatusKeyEvent | undefined) => void>(
		() => {},
	);
	useKeyboard((key) => {
		keyHandlerRef.current(key as StatusKeyEvent);
	});
	return (
		<StatusHubContent
			onDismiss={props.onDismiss}
			registerKeyHandler={(handler) => {
				keyHandlerRef.current = handler;
			}}
			source={props.source}
			bootstrap={props.bootstrap}
		/>
	);
}
