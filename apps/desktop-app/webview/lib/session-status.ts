import type { SessionStatusTone } from "@cline/ui";

/**
 * Session status presentation shared by every surface that renders a status
 * dot (chat header, sessions view, sidebar). Keeping the mapping in one place
 * means a session cannot look green in one view and grey in another.
 */
export function sessionStatusTone(status?: string): SessionStatusTone {
	if (status === "running") {
		return "running";
	}
	if (status === "failed" || status === "error") {
		return "error";
	}
	return "neutral";
}

export function sessionStatusColor(status?: string): string {
	switch (sessionStatusTone(status)) {
		case "running":
			return "var(--color-green-500)";
		case "error":
			return "var(--color-red-500)";
		default:
			return "var(--color-gray-500)";
	}
}
