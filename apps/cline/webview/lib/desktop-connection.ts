import type { DesktopTransportState } from "@/lib/desktop-transport";

const DESKTOP_CONNECTION_ERROR =
	/gateway_unreachable|timed out waiting for gateway method|desktop command timed out waiting for chat_session_command|desktop backend transport|bundled gateway|connection to the gateway was lost/i;

export function isDesktopConnectionError(message: string | null): boolean {
	return Boolean(message && DESKTOP_CONNECTION_ERROR.test(message));
}

export function actionableDesktopError(message: string): string {
	if (!isDesktopConnectionError(message)) return message;
	if (/timed out waiting for chat_session_command/i.test(message)) {
		return "The bundled Gateway did not acknowledge this message in time. Cline could not confirm whether the run started. Retry the connection to refresh its status before sending again.";
	}
	return `${message} Retry the bundled Gateway connection. Any run that was already accepted may still be working.`;
}

export function desktopConnectionCopy(
	state: DesktopTransportState,
	hasActiveRun: boolean,
): { title: string; description: string } {
	if (state === "unavailable") {
		return {
			title: "Bundled Gateway unavailable",
			description:
				"Cline could not start or reach its bundled Gateway. Retry the connection; your draft will stay here.",
		};
	}
	if (state === "reconnecting") {
		return {
			title: "Reconnecting to the bundled Gateway…",
			description: hasActiveRun
				? "The Gateway owns accepted runs, so the agent may still be working while this window reconnects."
				: "Cline is restoring the local desktop connection.",
		};
	}
	return {
		title: "Starting the bundled Gateway…",
		description:
			"Cline starts a local Gateway automatically before chat becomes available.",
	};
}
