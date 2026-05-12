import type {
	AgentMode,
	AgentResult,
	HubCommandEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";
import { parseHookEventPayload } from "../../../hooks";
import type { SendSessionInput } from "../../../runtime/host/runtime-host";
import { logHubMessage } from "../hub-server-logging";
import { cancelPendingApprovals } from "./approval-handlers";
import { cancelPendingCapabilityRequests } from "./capability-handlers";
import {
	errorReply,
	extractSessionId,
	type HubTransportContext,
	okReply,
	readCoreSessionSnapshot,
} from "./context";

const HUB_RUN_HEARTBEAT_MS = 30_000;

function terminalRunEventForReason(
	reason: string,
): "run.aborted" | "run.completed" | "run.failed" {
	if (reason === "aborted") return "run.aborted";
	if (reason === "error" || reason === "failed") return "run.failed";
	return "run.completed";
}

function errorMessageForResult(result: AgentResult): string | undefined {
	if (result.finishReason !== "error") {
		return undefined;
	}
	const text = result.text.trim();
	return text || undefined;
}

function parseTurnMode(mode?: unknown): AgentMode | undefined {
	// Unknown truthy values flow through and formatModePrompt treats them as act.
	return mode ? (mode as AgentMode) : undefined;
}

function parseRunTimeoutMs(
	payload: Record<string, unknown>,
): number | undefined {
	const timeoutMs =
		typeof payload.timeoutMs === "number"
			? payload.timeoutMs
			: typeof payload.timeout_ms === "number"
				? payload.timeout_ms
				: undefined;
	if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
		return Math.floor(timeoutMs);
	}
	const timeoutSeconds =
		typeof payload.timeoutSeconds === "number"
			? payload.timeoutSeconds
			: typeof payload.timeout_seconds === "number"
				? payload.timeout_seconds
				: undefined;
	if (timeoutSeconds && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0) {
		return Math.floor(timeoutSeconds * 1000);
	}
	return undefined;
}

async function runTurnWithRuntimeHealth(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	input: SendSessionInput,
	timeoutMs: number | undefined,
): Promise<AgentResult | undefined> {
	const startedAt = performance.now();
	let settled = false;
	const baseContext = {
		command: envelope.command,
		requestId: envelope.requestId,
		clientId: envelope.clientId,
		sessionId: input.sessionId,
		timeoutMs,
	};
	const heartbeat = setInterval(() => {
		if (settled) return;
		const elapsedMs = Math.round(performance.now() - startedAt);
		logHubMessage("warn", "run.heartbeat", {
			...baseContext,
			elapsedMs,
		});
		ctx.publish(
			ctx.buildEvent(
				"run.heartbeat",
				{
					requestId: envelope.requestId,
					elapsedMs,
					...(timeoutMs ? { timeoutMs } : {}),
				},
				input.sessionId,
			),
		);
	}, HUB_RUN_HEARTBEAT_MS);
	const runPromise = ctx.sessionHost.runTurn(input);
	runPromise.then(
		(result) => {
			if (!settled) return;
			logHubMessage("warn", "run.late_end", {
				...baseContext,
				elapsedMs: Math.round(performance.now() - startedAt),
				finishReason: result?.finishReason,
			});
		},
		(error) => {
			if (!settled) return;
			logHubMessage("error", "run.late_error", {
				...baseContext,
				elapsedMs: Math.round(performance.now() - startedAt),
				error,
			});
		},
	);
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		if (!timeoutMs) {
			return await runPromise;
		}
		return await Promise.race([
			runPromise,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => {
					const reason = `Hub run ${envelope.command} timed out after ${timeoutMs}ms.`;
					settled = true;
					clearInterval(heartbeat);
					reject(new Error(reason));
					logHubMessage("error", "run.timeout", {
						...baseContext,
						elapsedMs: Math.round(performance.now() - startedAt),
					});
					cancelPendingApprovals(
						ctx,
						(approval) => approval.sessionId === input.sessionId,
						reason,
					);
					cancelPendingCapabilityRequests(
						ctx,
						(request) => request.sessionId === input.sessionId,
						reason,
					);
					void ctx.sessionHost.abort(input.sessionId, reason).catch((error) => {
						logHubMessage("error", "run.timeout_abort_failed", {
							...baseContext,
							error,
						});
					});
				}, timeoutMs);
			}),
		]);
	} finally {
		settled = true;
		clearInterval(heartbeat);
		if (timeout) clearTimeout(timeout);
	}
}

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
	const timeoutMs = parseRunTimeoutMs(payload);
	ctx.suppressNextTerminalEventBySession.set(sessionId, "run.start.reply");
	let result: AgentResult | undefined;
	try {
		result = await runTurnWithRuntimeHealth(
			ctx,
			envelope,
			{
				sessionId,
				prompt,
				mode: parseTurnMode(payload.mode),
				delivery:
					payload.delivery === "queue" || payload.delivery === "steer"
						? payload.delivery
						: undefined,
				userImages: Array.isArray(attachments?.userImages)
					? (attachments.userImages as string[])
					: undefined,
				userFiles,
				timeoutMs,
			},
			timeoutMs,
		);
	} catch (error) {
		if (
			ctx.suppressNextTerminalEventBySession.get(sessionId) ===
			"run.start.reply"
		) {
			ctx.suppressNextTerminalEventBySession.delete(sessionId);
		}
		ctx.publish(
			ctx.buildEvent(
				"run.failed",
				{
					reason: "error",
					error: error instanceof Error ? error.message : String(error),
				},
				sessionId,
			),
		);
		throw error;
	}
	if (result) {
		const snapshot = await readCoreSessionSnapshot(ctx, sessionId);
		const error = errorMessageForResult(result);
		ctx.publish(
			ctx.buildEvent(
				terminalRunEventForReason(result.finishReason),
				{
					reason: result.finishReason,
					...(error ? { error } : {}),
					result,
					...(snapshot ? { snapshot } : {}),
				},
				sessionId,
			),
		);
		if (
			ctx.suppressNextTerminalEventBySession.get(sessionId) ===
			"run.start.reply"
		) {
			ctx.suppressNextTerminalEventBySession.delete(sessionId);
		}
	} else {
		ctx.suppressNextTerminalEventBySession.delete(sessionId);
	}
	const snapshot = await readCoreSessionSnapshot(ctx, sessionId);
	return okReply(
		envelope,
		result || snapshot
			? { ...(result ? { result } : {}), ...(snapshot ? { snapshot } : {}) }
			: undefined,
	);
}

export async function handleRunAbort(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const reason =
		typeof envelope.payload?.reason === "string"
			? envelope.payload.reason
			: "Run was aborted before pending approval or capability request was resolved.";
	cancelPendingApprovals(
		ctx,
		(approval) => approval.sessionId === sessionId,
		reason,
	);
	await ctx.sessionHost.abort(sessionId, envelope.payload?.reason);
	cancelPendingCapabilityRequests(
		ctx,
		(request) => request.sessionId === sessionId,
		reason,
	);
	ctx.publish(ctx.buildEvent("run.aborted", { reason }, sessionId));
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
	await ctx.sessionHost.dispatchHookEvent(parsed);
	return okReply(envelope, { applied: true });
}
