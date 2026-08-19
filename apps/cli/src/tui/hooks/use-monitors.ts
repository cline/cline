import { useCallback, useState } from "react";
import type { MonitorStateSnapshot } from "../../runtime/session-events";
import type { MonitorItem } from "../types";

export function toMonitorItems(event: MonitorStateSnapshot): MonitorItem[] {
	return event.monitors.map((monitor) => ({
		id: monitor.id,
		name: monitor.name,
		description: monitor.description,
		command: monitor.command,
		startedAt: monitor.startedAt,
		status: monitor.status,
		exitCode: monitor.exitCode,
		error: monitor.error,
		linesEmitted: monitor.linesEmitted,
	}));
}

export function countRunningMonitors(monitors: MonitorItem[]): number {
	return monitors.filter((monitor) => monitor.status === "running").length;
}

/** Status-bar summary, e.g. "◉ 2 monitors" / "◉ 1 monitor". Empty when none run. */
export function formatMonitorStatusText(monitors: MonitorItem[]): string {
	const running = countRunningMonitors(monitors);
	if (running === 0) {
		return "";
	}
	return `◉ ${running} monitor${running === 1 ? "" : "s"}`;
}

export function formatMonitorUptime(startedAt: number, now: number): string {
	const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}

export function formatMonitorListRow(
	monitor: MonitorItem,
	now: number,
): string {
	const status =
		monitor.status === "running"
			? `running ${formatMonitorUptime(monitor.startedAt, now)}`
			: monitor.status;
	const lines = `${monitor.linesEmitted} line${
		monitor.linesEmitted === 1 ? "" : "s"
	}`;
	return `${monitor.name} [${status}] ${lines} — ${monitor.description}`;
}

export function useMonitors() {
	const [monitors, setMonitors] = useState<MonitorItem[]>([]);

	const handleMonitorState = useCallback((event: MonitorStateSnapshot) => {
		setMonitors(toMonitorItems(event));
	}, []);

	return { monitors, handleMonitorState };
}
