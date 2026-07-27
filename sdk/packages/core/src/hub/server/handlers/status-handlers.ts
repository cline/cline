/**
 * Status Hub command handlers (ARD-0005).
 *
 * Publishing goes through the hub so every connected client sees the update
 * immediately (`status.updated`), while the durable copy lands in status.db
 * for anyone who was not listening. High and critical updates additionally
 * raise `ui.notify` so they reach the human rather than waiting to be found.
 */

import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import {
	StatusPrunePayloadSchema,
	StatusPublishInputSchema,
	StatusQuerySchema,
	type StatusUpdate,
	shouldPushToUser,
} from "@cline/shared";
import { z } from "zod";
import { getStatusService, type StatusService } from "../../../status";
import { errorReply, type HubTransportContext, okReply } from "./context";

const SubjectPayloadSchema = z.object({ subject: z.string().min(1) }).strict();

const SubjectsPayloadSchema = z
	.object({ limit: z.number().int().positive().max(1000).optional() })
	.strict();

/** Serialize an update for the wire (payloads are plain JSON records). */
function toPayload(update: StatusUpdate): Record<string, unknown> {
	return update as unknown as Record<string, unknown>;
}

function notifyPayload(update: StatusUpdate): Record<string, unknown> {
	return {
		title:
			update.priority === "critical"
				? `Blocked: ${update.agentName ?? update.subject}`
				: (update.agentName ?? update.subject),
		message: update.headline,
		severity: update.state === "failed" ? "error" : "warn",
		subject: update.subject,
		updateId: update.updateId,
		seq: update.seq,
	};
}

export async function handleStatusCommand(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	service: StatusService = getStatusService(),
): Promise<HubReplyEnvelope> {
	const payload = envelope.payload ?? {};

	try {
		switch (envelope.command) {
			case "status.publish": {
				const input = StatusPublishInputSchema.parse({
					source: "hub",
					...payload,
					sessionId:
						(payload.sessionId as string | undefined) ?? envelope.sessionId,
				});
				const update = service.publish(input);

				ctx.publish(
					ctx.buildEvent("status.updated", toPayload(update), update.sessionId),
				);
				if (shouldPushToUser(update.priority)) {
					ctx.publish(ctx.buildEvent("ui.notify", notifyPayload(update)));
				}
				return okReply(envelope, { update: toPayload(update) });
			}

			case "status.query": {
				const query = StatusQuerySchema.parse(payload);
				return okReply(envelope, {
					...service.query(query),
					ftsAvailable: service.ftsAvailable,
				});
			}

			case "status.board": {
				// Attention ordering matters even though the client groups by
				// state: with more subjects than fit on a page, recency order
				// could leave every blocked row off page 1 and the grouping
				// would then be quietly wrong.
				const query = StatusQuerySchema.parse({
					orderBy: "attention",
					includeHistoryCount: true,
					...payload,
					currentOnly: true,
				});
				return okReply(envelope, {
					...service.query(query),
					ftsAvailable: service.ftsAvailable,
				});
			}

			case "status.summary": {
				return okReply(envelope, {
					summary: service.summary() as unknown as Record<string, unknown>,
				});
			}

			case "status.current": {
				const { subject } = SubjectPayloadSchema.parse(payload);
				const update = service.current(subject);
				return okReply(envelope, {
					update: update ? toPayload(update) : null,
				});
			}

			case "status.subjects": {
				const { limit } = SubjectsPayloadSchema.parse(payload);
				return okReply(envelope, { subjects: service.subjects(limit) });
			}

			case "status.prune": {
				const prunePayload = StatusPrunePayloadSchema.parse(payload);
				return okReply(envelope, { deleted: service.prune(prunePayload) });
			}

			default:
				return errorReply(
					envelope,
					"unsupported_command",
					`Unsupported status command: ${envelope.command}`,
				);
		}
	} catch (error) {
		if (error instanceof z.ZodError) {
			return errorReply(
				envelope,
				"invalid_payload",
				error.issues[0]?.message ?? "invalid payload",
			);
		}
		return errorReply(
			envelope,
			"status_error",
			error instanceof Error ? error.message : "status command failed",
		);
	}
}
