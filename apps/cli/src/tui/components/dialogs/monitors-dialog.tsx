import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useState } from "react";
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
 * Marks one monitor stopped in a local roster copy. The authoritative state
 * arrives through the next monitor-state event; this keeps the open dialog
 * honest in the meantime.
 */
export function markMonitorStopped(
	monitors: MonitorItem[],
	monitorId: string,
): MonitorItem[] {
	return monitors.map((monitor) =>
		monitor.id === monitorId && monitor.status === "running"
			? { ...monitor, status: "stopped" }
			: monitor,
	);
}

export function MonitorsContent(
	props: ChoiceContext<boolean> & {
		monitors: MonitorItem[];
		onStopMonitor: (monitorId: string) => Promise<boolean>;
	},
) {
	const [selected, setSelected] = useState(0);
	const [monitors, setMonitors] = useState(props.monitors);
	const [stopping, setStopping] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const itemCount = monitors.length;
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
			setSelected((s) => (s > 0 ? s - 1 : itemCount - 1));
			return;
		}
		if (key.name === "down") {
			setError(null);
			setSelected((s) => (s < itemCount - 1 ? s + 1 : 0));
			return;
		}
		if (key.name === "space") {
			const target = monitors[selected];
			if (!target || target.status !== "running" || stopping) {
				return;
			}
			setStopping(target.id);
			setError(null);
			props
				.onStopMonitor(target.id)
				.then((stopped) => {
					if (stopped) {
						setMonitors((current) => markMonitorStopped(current, target.id));
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
						const isSelected = index === selected;
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

			{monitors[selected] && (
				<box flexDirection="column" marginTop={1}>
					<text fg="gray">command: {monitors[selected].command}</text>
					<text fg="gray">
						lines delivered: {monitors[selected].linesEmitted}
					</text>
					{monitors[selected].error && (
						<text fg={palette.error}>{monitors[selected].error}</text>
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
