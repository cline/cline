import type { HubCommandEnvelope, HubReplyEnvelope } from "@clinebot/shared";
import { parseHookEventPayload } from "../../../hooks";
import {
	errorReply,
	extractSessionId,
	type HubTransportContext,
	okReply,
} from "./context";

export async function handleSessionInput(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const payload =
		envelope.payload && typeof envelope.payload === "object"
			? envelope.payload
			: {};
	const prompt =
		typeof payload.prompt === "string"
			? payload.prompt
			: typeof payload.input === "string"
				? payload.input
				: "";
	if (!prompt.trim()) {
		return errorReply(
			envelope,
			"invalid_session_input",
			"session input requires a prompt string",
		);
	}
	ctx.publish(ctx.buildEvent("run.started", undefined, sessionId));
	const attachments =
		payload.attachments &&
		typeof payload.attachments === "object" &&
		!Array.isArray(payload.attachments)
			? (payload.attachments as Record<string, unknown>)
			: undefined;
	const userFiles = Array.isArray(attachments?.userFiles)
		? attachments.userFiles.filter((filePath) => typeof filePath === "string")
		: undefined;
	const result = await ctx.sessionHost.send({
		sessionId,
		prompt,
		delivery:
			payload.delivery === "queue" || payload.delivery === "steer"
				? payload.delivery
				: undefined,
		userImages: Array.isArray(attachments?.userImages)
			? (attachments.userImages as string[])
			: undefined,
		userFiles,
	});
	if (result) {
		ctx.suppressNextTerminalEventBySession.set(sessionId, result.finishReason);
		ctx.publish(
			ctx.buildEvent(
				"run.completed",
				{ reason: result.finishReason, result },
				sessionId,
			),
		);
	}
	return okReply(envelope, result ? { result } : undefined);
}

export async function handleRunAbort(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	await ctx.sessionHost.abort(sessionId, envelope.payload?.reason);
	ctx.publish(
		ctx.buildEvent(
			"run.aborted",
			typeof envelope.payload?.reason === "string"
				? { reason: envelope.payload.reason }
				: undefined,
			sessionId,
		),
	);
	return okReply(envelope, { applied: true });
}

export async function handleSessionHook(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const parsed = parseHookEventPayload(envelope.payload?.payload);
	if (!parsed) {
		return errorReply(
			envelope,
			"invalid_hook_payload",
			"session.hook requires a valid hook event payload",
		);
	}
	await ctx.sessionHost.handleHookEvent(parsed);
	return okReply(envelope, { applied: true });
}
