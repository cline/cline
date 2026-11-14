import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import {
	isSessionNotFoundError,
	SESSION_NOT_FOUND_ERROR_CODE,
} from "../../../runtime/host/runtime-host";
import {
	asPlainRecord,
	errorReply,
	extractSessionId,
	type HubTransportContext,
	okReply,
} from "./context";

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value
		: undefined;
}

function failureReply(
	envelope: HubCommandEnvelope,
	code: string,
	error: unknown,
): HubReplyEnvelope {
	const message = error instanceof Error ? error.message : String(error);
	return errorReply(
		envelope,
		isSessionNotFoundError(error) ? SESSION_NOT_FOUND_ERROR_CODE : code,
		message,
	);
}

export async function handleSessionMcpAppsResolveTool(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const toolName = readString(envelope.payload?.toolName);
	if (!sessionId || !toolName) {
		return errorReply(
			envelope,
			"invalid_mcp_apps_resolve_tool",
			"session.mcp_apps.resolve_tool requires a sessionId and toolName",
		);
	}
	const resolveMcpAppTool = ctx.sessionHost.resolveMcpAppTool;
	if (!resolveMcpAppTool) {
		return okReply(envelope, {});
	}
	try {
		const binding = await resolveMcpAppTool.call(
			ctx.sessionHost,
			sessionId,
			toolName,
		);
		return okReply(envelope, binding ? { binding } : {});
	} catch (error) {
		return failureReply(envelope, "mcp_apps_resolve_tool_failed", error);
	}
}

export async function handleSessionMcpAppsReadResource(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const serverName = readString(envelope.payload?.serverName);
	const uri = readString(envelope.payload?.uri);
	if (!sessionId || !serverName || !uri) {
		return errorReply(
			envelope,
			"invalid_mcp_apps_read_resource",
			"session.mcp_apps.read_resource requires a sessionId, serverName, and uri",
		);
	}
	const readMcpAppResource = ctx.sessionHost.readMcpAppResource;
	if (!readMcpAppResource) {
		return errorReply(
			envelope,
			"unsupported_command",
			"This runtime does not support MCP Apps.",
		);
	}
	try {
		const result = await readMcpAppResource.call(ctx.sessionHost, sessionId, {
			serverName,
			uri,
		});
		return okReply(envelope, { result });
	} catch (error) {
		return failureReply(envelope, "mcp_apps_read_resource_failed", error);
	}
}

export async function handleSessionMcpAppsCallTool(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const serverName = readString(envelope.payload?.serverName);
	const toolName = readString(envelope.payload?.toolName);
	const rawArguments = envelope.payload?.arguments;
	const toolArguments = asPlainRecord(rawArguments);
	if (
		!sessionId ||
		!serverName ||
		!toolName ||
		(rawArguments !== undefined && !toolArguments)
	) {
		return errorReply(
			envelope,
			"invalid_mcp_apps_call_tool",
			"session.mcp_apps.call_tool requires a sessionId, serverName, toolName, and object arguments",
		);
	}
	const callMcpAppTool = ctx.sessionHost.callMcpAppTool;
	if (!callMcpAppTool) {
		return errorReply(
			envelope,
			"unsupported_command",
			"This runtime does not support MCP Apps.",
		);
	}
	try {
		const result = await callMcpAppTool.call(ctx.sessionHost, sessionId, {
			serverName,
			toolName,
			...(toolArguments ? { arguments: toolArguments } : {}),
		});
		return okReply(envelope, { result });
	} catch (error) {
		return failureReply(envelope, "mcp_apps_call_tool_failed", error);
	}
}
