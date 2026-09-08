import { z } from "zod";

/**
 * A detached command's process outcome, as delivered by completion events and
 * reconstructed from detached-log markers. Hosts and clients share this
 * vocabulary so a detached completion reads identically whether it arrived
 * live or was resolved at hydration.
 */
export const DetachedCommandOutcomeSchema = z.union([
	z.object({ kind: z.literal("exited"), exitCode: z.number().int() }),
	z.object({ kind: z.literal("signaled"), signal: z.string() }),
	z.object({ kind: z.literal("hard_killed") }),
	z.object({ kind: z.literal("failed"), error: z.string() }),
]);

export type DetachedCommandOutcome = z.infer<
	typeof DetachedCommandOutcomeSchema
>;

/** How a detached command row renders its background lifecycle. */
export type DetachedCommandBackgroundStatus =
	| "running"
	| "succeeded"
	| "failed"
	| "killed"
	| "indeterminate";

/**
 * The notice a command executor writes into a detached command's partial
 * output — the only persisted trace that a tool call ended by detaching
 * rather than completing.
 */
const DETACHED_COMMAND_NOTICE_PREFIX =
	"[Command is still running. Output will continue in ";

/**
 * Extracts the detached log path from a tool result's still-running notice, or
 * null when the result never detached.
 */
export function matchDetachedCommandNotice(text: string): string | null {
	let offset = 0;
	while (offset < text.length) {
		const start = text.indexOf(DETACHED_COMMAND_NOTICE_PREFIX, offset);
		if (start < 0) return null;
		const pathStart = start + DETACHED_COMMAND_NOTICE_PREFIX.length;
		const end = text.indexOf("]", pathStart);
		// No later prefix can close either, so never rescan an unterminated suffix.
		if (end < 0) return null;
		if (end > pathStart) return text.slice(pathStart, end);
		offset = end + 1;
	}
	return null;
}

/**
 * Maps a detached command's process outcome to the row's background status —
 * the same mapping the live completion event path applies.
 */
export function detachedCommandBackgroundStatus(
	outcome: DetachedCommandOutcome,
): DetachedCommandBackgroundStatus {
	if (outcome.kind === "exited") {
		return outcome.exitCode === 0 ? "succeeded" : "failed";
	}
	if (outcome.kind === "hard_killed") {
		return "killed";
	}
	if (outcome.kind === "signaled") {
		return "indeterminate";
	}
	return "failed";
}

/**
 * Renders a detached command's process outcome as the row's completion note.
 * Shared by every surface that describes a detached completion — the desktop
 * webview's live event path and the sidecar's hydration enrichment — so the
 * vocabulary cannot drift between them.
 */
export function formatDetachedCompletionNote(
	outcome: DetachedCommandOutcome,
): string {
	if (outcome.kind === "exited") {
		return `[Detached command completed with exit code ${outcome.exitCode}]`;
	}
	if (outcome.kind === "signaled") {
		return `[Detached command ended from signal ${outcome.signal}]`;
	}
	if (outcome.kind === "hard_killed") {
		return "[Detached command reached its hard deadline and was terminated]";
	}
	return `[Detached command failed: ${outcome.error}]`;
}
