import {
	DEFAULT_MAX_CONCURRENT_CHAT_FORKS,
	tickChatForks,
} from "@cline/drive";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { getDriveRoomStore } from "../../collaboration";
import { errorReply, type HubTransportContext, okReply } from "./context";
import { handleDriveForkCommand } from "./drive-fork-handlers";

/**
 * Claim next Do items via tickChatForks. Requires parentSessionId + assignee
 * on the payload (or defaults from the first linked non-worker session).
 */
export async function runChatForkDirectorTick(
	ctx: HubTransportContext,
	input: {
		roomId: string;
		parentSessionId?: string;
		assigneeParticipantId?: string;
		parentBriefing?: string;
		maxConcurrent?: number;
		worktreeIsolationAvailable?: boolean;
	},
): Promise<{ claimed: number; errors: string[] }> {
	const store = getDriveRoomStore();
	store.create(input.roomId);
	const room = store.getOrCreateLive(input.roomId);
	const intents = tickChatForks({
		director: room.director,
		chatForks: room.chatForks ?? [],
		maxConcurrent: input.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_CHAT_FORKS,
	});

	const parentSessionId =
		input.parentSessionId ??
		[...(store.roomToSessions.get(input.roomId) ?? [])].find((sessionId) => {
			const fork = (room.chatForks ?? []).some(
				(entry) => entry.workerSessionId === sessionId,
			);
			return !fork;
		});

	const assigneeParticipantId =
		input.assigneeParticipantId ??
		room.spotlightParticipantId ??
		room.seatedParticipantIds[0];

	if (!parentSessionId || !assigneeParticipantId) {
		return {
			claimed: 0,
			errors: ["parentSessionId and assigneeParticipantId required for tick"],
		};
	}

	let claimed = 0;
	const errors: string[] = [];
	for (const intent of intents) {
		const prefixes =
			intent.doItem.id.length > 0 ? [`src/${intent.doItem.id}`] : [];
		const reply = await handleDriveForkCommand(ctx, {
			version: "v1",
			command: "drive.fork.claim",
			requestId: `tick_${intent.doItem.id}`,
			payload: {
				roomId: input.roomId,
				parentSessionId,
				assigneeParticipantId,
				parentBriefing: input.parentBriefing ?? "",
				doItem: intent.doItem,
				workspace: {
					mode: prefixes.length > 0 ? "path_disjoint" : "shared_readonly",
				},
				allowedPathPrefixes: prefixes,
				reason: "do_claim",
				worktreeIsolationAvailable: input.worktreeIsolationAvailable ?? false,
				maxConcurrent: input.maxConcurrent,
			},
		});
		if (reply.ok) {
			claimed += 1;
		} else {
			errors.push(reply.error?.message ?? "claim failed");
		}
	}
	return { claimed, errors };
}

export async function handleDriveForkTickCommand(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const roomId =
		typeof envelope.payload?.roomId === "string" && envelope.payload.roomId.trim()
			? envelope.payload.roomId.trim()
			: "default";
	const parentSessionId =
		typeof envelope.payload?.parentSessionId === "string"
			? envelope.payload.parentSessionId
			: undefined;
	const assigneeParticipantId =
		typeof envelope.payload?.assigneeParticipantId === "string"
			? envelope.payload.assigneeParticipantId
			: undefined;
	const result = await runChatForkDirectorTick(ctx, {
		roomId,
		parentSessionId,
		assigneeParticipantId,
		parentBriefing:
			typeof envelope.payload?.parentBriefing === "string"
				? envelope.payload.parentBriefing
				: undefined,
		maxConcurrent:
			typeof envelope.payload?.maxConcurrent === "number"
				? envelope.payload.maxConcurrent
				: undefined,
		worktreeIsolationAvailable:
			typeof envelope.payload?.worktreeIsolationAvailable === "boolean"
				? envelope.payload.worktreeIsolationAvailable
				: undefined,
	});
	const store = getDriveRoomStore();
	const room = store.getOrCreateLive(roomId);
	if (result.errors.length > 0 && result.claimed === 0) {
		return errorReply(
			envelope,
			"tick_failed",
			result.errors.join("; ") || "tick failed",
		);
	}
	return okReply(envelope, { room, ...result });
}
