/**
 * Origin-session delivery for agent-created scheduled tasks.
 *
 * When an agent creates a schedule with `deliverTo: "origin_session"`, the
 * scheduled run still executes in its own isolated session. On completion, its
 * result is fed back into the session that created the schedule as a queued
 * follow-up turn, so the main agent can continue working with it.
 *
 * Delivery is best-effort: if the origin session is not currently active
 * (persisted-but-not-in-memory), `runTurn` rejects and we skip rather than
 * throw. Appending into a persisted-but-inactive session is a follow-up.
 */

import type { RuntimeHost } from "../../runtime/host/runtime-host";

interface LooseMessage {
	role?: string;
	content?: unknown;
}

function extractText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === "string") {
					return part;
				}
				if (
					part &&
					typeof part === "object" &&
					"text" in part &&
					typeof (part as { text?: unknown }).text === "string"
				) {
					return (part as { text: string }).text;
				}
				return "";
			})
			.join("");
	}
	return "";
}

function extractLastAssistantText(
	messages: readonly LooseMessage[],
): string | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		if (messages[i]?.role === "assistant") {
			const text = extractText(messages[i]?.content).trim();
			if (text) {
				return text;
			}
		}
	}
	return undefined;
}

export interface OriginSessionDeliveryInput {
	host: RuntimeHost;
	/** Session that created the schedule (delivery target). */
	originSessionId: string;
	/** Session the scheduled run executed in (source of the reply). */
	runSessionId?: string;
	scheduleId: string;
	/** Normalized execution status ("success" | "failed" | ...). */
	status: string;
	errorMessage?: string;
	logger?: { log?: (message: string, meta?: unknown) => void };
}

/**
 * Deliver a completed scheduled run's result into its origin session as a
 * queued follow-up turn. Returns true when the turn was queued, false when the
 * origin session was not active (skipped) or delivery otherwise failed.
 */
export async function deliverScheduleResultToOriginSession(
	input: OriginSessionDeliveryInput,
): Promise<boolean> {
	const { host, originSessionId, runSessionId } = input;
	if (!originSessionId) {
		return false;
	}

	let body: string;
	if (input.status === "success" && runSessionId) {
		const messages = (await host
			.readSessionMessages(runSessionId)
			.catch(() => [])) as readonly LooseMessage[];
		const text = extractLastAssistantText(messages);
		body = text
			? `[Scheduled task ${input.scheduleId} completed]\n\n${text}`
			: `[Scheduled task ${input.scheduleId} completed with no textual output.]`;
	} else {
		body = `[Scheduled task ${input.scheduleId} ${input.status}]${
			input.errorMessage ? `: ${input.errorMessage}` : "."
		}`;
	}

	try {
		await host.runTurn({
			sessionId: originSessionId,
			prompt: body,
			delivery: "queue",
		});
		return true;
	} catch (error) {
		input.logger?.log?.(
			`schedule origin-session delivery skipped (session not active): ${originSessionId}`,
			{ error: error instanceof Error ? error.message : String(error) },
		);
		return false;
	}
}
