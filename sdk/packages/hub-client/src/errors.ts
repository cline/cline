import type {
	HubCommandEnvelope,
	HubIncompatibleProtocolDetails,
} from "@cline/shared";
import { HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE } from "@cline/shared";
import { decodeCloseReason } from "./decode";

export const DEFAULT_HUB_CLOSED_MESSAGE = "Hub connection closed";

export type HubTransportErrorCode =
	| "hub_connect_timeout"
	| "hub_connect_failed"
	| "hub_connection_closed"
	| "hub_connection_not_open";

export class HubTransportError extends Error {
	constructor(
		readonly code: HubTransportErrorCode,
		message: string,
		readonly details?: { closeCode?: number; closeReason?: string },
	) {
		super(message);
		this.name = "HubTransportError";
	}
}

export function isHubReconnectableTransportError(
	error: unknown,
): error is HubTransportError {
	return error instanceof HubTransportError;
}

export class HubCommandError extends Error {
	constructor(
		readonly command: HubCommandEnvelope["command"],
		readonly code: string | undefined,
		message: string,
	) {
		super(message);
		this.name = "HubCommandError";
	}
}

function readOptionalString(
	details: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = details?.[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * The hub refused `client.register` because this client's protocol version is
 * outside its supported range. Terminal by design: the transport is fine, so
 * reconnecting cannot help — only a version change on either side can.
 *
 * Extends `HubCommandError` so existing `catch` sites keep working; it is
 * deliberately *not* a `HubTransportError`, which is what keeps it out of the
 * reconnect/recovery paths.
 */
/**
 * A command reply was structurally invalid — a field the caller must be able to
 * trust (e.g. the `approvals` array of `approval.list_pending`) was absent or the
 * wrong type. Thrown instead of coercing to an empty/default value, so protocol
 * corruption cannot masquerade as an authoritative "nothing here" answer.
 */
export class HubMalformedReplyError extends HubCommandError {
	constructor(command: HubCommandEnvelope["command"], message: string) {
		super(command, "malformed_reply", message);
		this.name = "HubMalformedReplyError";
	}
}

export class IncompatibleProtocolError extends HubCommandError {
	readonly details: HubIncompatibleProtocolDetails;

	constructor(
		command: HubCommandEnvelope["command"],
		message: string,
		details?: Record<string, unknown>,
	) {
		super(command, HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE, message);
		this.name = "IncompatibleProtocolError";
		this.details = {
			serverProtocolVersion: readOptionalString(
				details,
				"serverProtocolVersion",
			),
			minClientProtocolVersion: readOptionalString(
				details,
				"minClientProtocolVersion",
			),
			maxClientProtocolVersion: readOptionalString(
				details,
				"maxClientProtocolVersion",
			),
			clientProtocolVersion: readOptionalString(
				details,
				"clientProtocolVersion",
			),
		};
	}
}

export function isHubCommandTimeoutError(
	error: unknown,
	command?: HubCommandEnvelope["command"],
): boolean {
	return (
		error instanceof HubCommandError &&
		error.code === "hub_command_timeout" &&
		(command === undefined || error.command === command)
	);
}

export function createHubCloseError(event: unknown): HubTransportError {
	const closeEvent = event as { code?: number; reason?: unknown };
	const reasonText = decodeCloseReason(closeEvent?.reason);
	return new HubTransportError(
		"hub_connection_closed",
		closeEvent?.code || reasonText
			? `Hub connection closed (code=${closeEvent?.code ?? 0}${reasonText ? `, reason=${reasonText}` : ""})`
			: DEFAULT_HUB_CLOSED_MESSAGE,
		{
			closeCode: closeEvent?.code,
			closeReason: reasonText || undefined,
		},
	);
}

export function normalizeWebSocketConnectError(
	error: unknown,
	url: URL | string,
): HubTransportError {
	if (error instanceof HubTransportError) {
		return error;
	}
	if (error instanceof Error) {
		return new HubTransportError("hub_connect_failed", error.message);
	}
	if (
		error &&
		typeof error === "object" &&
		"error" in error &&
		(error as { error?: unknown }).error instanceof Error
	) {
		return new HubTransportError(
			"hub_connect_failed",
			(error as { error: Error }).error.message,
		);
	}
	const message =
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof (error as { message?: unknown }).message === "string"
			? (error as { message: string }).message.trim()
			: "";
	if (message) {
		return new HubTransportError("hub_connect_failed", message);
	}
	const eventType =
		error &&
		typeof error === "object" &&
		"type" in error &&
		typeof (error as { type?: unknown }).type === "string"
			? (error as { type: string }).type.trim()
			: "";
	return new HubTransportError(
		"hub_connect_failed",
		eventType
			? `Failed to connect to hub at ${url.toString()} (${eventType} event before socket open).`
			: `Failed to connect to hub at ${url.toString()}.`,
	);
}
