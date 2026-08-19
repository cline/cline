import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useState, useSyncExternalStore } from "react";
import { palette } from "../../palette";
import type { MonitorItem } from "../../types";

export function getMonitorsFooterText(hasRunning: boolean): string {
	return hasRunning
		? "Space to stop selected, Esc to go back"
		: "Esc to go back";
}

export function getMonitorStatusLabel(monitor: MonitorItem): string {
	switch (monitor.status) {
		case "running":
			return "running";
		case "stopped":
			return "stopped";
		case "failed":
			return "failed";
		default:
			return monitor.exitCode !== undefined && monitor.exitCode !== null
				? `exited (${monitor.exitCode})`
				: "exited";
	}
}

export function getMonitorRowColor(
	monitor: MonitorItem,
	isSelected: boolean,
): string {
	if (monitor.status === "failed") {
		return palette.error;
	}
	if (monitor.status === "running") {
		return palette.success;
	}
	return isSelected ? palette.act : "gray";
}

/**
 * Overlays optimistic local stops onto an authoritative roster snapshot.
 * A stop that resolved true flips its row immediately; the registry's next
 * monitor_state snapshot then carries the real terminal status and wins.
 */
export function applyLocalStops(
	monitors: readonly MonitorItem[],
	stoppedIds: ReadonlySet<string>,
): MonitorItem[] {
	return monitors.map((monitor) =>
		stoppedIds.has(monitor.id) && monitor.status === "running"
			? { ...monitor, status: "stopped" }
			: monitor,
	);
}

/** Keeps the selection on a valid row while the live roster grows or shrinks. */
export function clampSelection(selected: number, itemCount: number): number {
	if (itemCount === 0) {
		return 0;
	}
	return Math.min(Math.max(selected, 0), itemCount - 1);
}

export function MonitorsContent(
	props: ChoiceContext<boolean> & {
		/** Subscribes to roster changes; the dialog stays live while open. */
		subscribeMonitors: (listener: () => void) => () => void;
		getMonitors: () => MonitorItem[];
		onStopMonitor: (monitorId: string) => Promise<boolean>;
	},
) {
	const liveMonitors = useSyncExternalStore(
		props.subscribeMonitors,
		props.getMonitors,
	);
	const [selected, setSelected] = useState(0);
	const [stoppedIds, setStoppedIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [stopping, setStopping] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const monitors = applyLocalStops(liveMonitors, stoppedIds);
	const itemCount = monitors.length;
	const selectedIndex = clampSelection(selected, itemCount);
	const hasRunning = monitors.some((monitor) => monitor.status === "running");

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			props.resolve(true);
			return;
		}
		if (itemCount === 0) {
			return;
		}
		if (key.name === "up") {
			setError(null);
			setSelected(selectedIndex > 0 ? selectedIndex - 1 : itemCount - 1);
			return;
		}
		if (key.name === "down") {
			setError(null);
			setSelected(selectedIndex < itemCount - 1 ? selectedIndex + 1 : 0);
			return;
		}
		if (key.name === "space") {
			const target = monitors[selectedIndex];
			if (!target || target.status !== "running" || stopping) {
				return;
			}
			setStopping(target.id);
			setError(null);
			props
				.onStopMonitor(target.id)
				.then((stopped) => {
					if (stopped) {
						setStoppedIds((current) => new Set(current).add(target.id));
					} else {
						setError(`Monitor "${target.name}" is no longer running.`);
					}
				})
				.catch((cause) => {
					setError(cause instanceof Error ? cause.message : String(cause));
				})
				.finally(() => setStopping(null));
			return;
		}
	}, props.dialogId);

	const selectedMonitor = monitors[selectedIndex];

	return (
		<box flexDirection="column" paddingX={1}>
			<text fg={palette.act}>Background Monitors</text>

			<text fg="gray" marginTop={1}>
				Watches started by the agent with the monitor tool. Output arrives in
				chat as it happens.
			</text>

			{itemCount > 0 && (
				<box flexDirection="column" marginTop={1}>
					{monitors.map((monitor, index) => {
						const isSelected = index === selectedIndex;
						const statusLabel =
							stopping === monitor.id
								? "stopping…"
								: getMonitorStatusLabel(monitor);
						return (
							<box
								key={monitor.id}
								flexDirection="row"
								justifyContent="space-between"
							>
								<text fg={getMonitorRowColor(monitor, isSelected)}>
									{isSelected ? "\u25b8 " : "  "}
									{monitor.status === "running" ? "● " : "○ "}
									{monitor.name}
									{"  "}
									{monitor.description}
								</text>
								<text fg="gray">{statusLabel}</text>
							</box>
						);
					})}
				</box>
			)}

			{itemCount === 0 && (
				<text fg="gray" marginTop={1}>
					No monitors in this session.
				</text>
			)}

			{selectedMonitor && (
				<box flexDirection="column" marginTop={1}>
					<text fg="gray">command: {selectedMonitor.command}</text>
					<text fg="gray">lines delivered: {selectedMonitor.linesEmitted}</text>
					{selectedMonitor.error && (
						<text fg={palette.error}>{selectedMonitor.error}</text>
					)}
				</box>
			)}

			{error && (
				<text fg={palette.error} marginTop={1}>
					{error}
				</text>
			)}

			<text fg="gray" marginTop={1}>
				<em>{getMonitorsFooterText(hasRunning)}</em>
			</text>
		</box>
	);
}
