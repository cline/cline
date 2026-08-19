/**
 * `PublicDesktopError` — the ONLY error shape the webview ever sees.
 *
 * The broker maps Gateway wire errors (and its own failures) onto this
 * closed shape. Raw diagnostics, stack traces, filesystem paths, and
 * secrets never cross the bridge; the `action` field tells the UI what
 * a user can actually do about the failure.
 */

export const DESKTOP_ERROR_ACTIONS = [
	"retry",
	"start_gateway",
	"update_client",
	"choose_workspace",
	"none",
] as const;

export type DesktopErrorAction = (typeof DESKTOP_ERROR_ACTIONS)[number];

export interface PublicDesktopError {
	/** Stable machine-readable code (Gateway codes pass through). */
	code: string;
	/** Sanitized human-readable message (bounded, no control chars). */
	message: string;
	retryable: boolean;
	correlationId?: string;
	action?: DesktopErrorAction;
}

const MAX_MESSAGE_LENGTH = 512;

/** Strip C0 control characters (except space) and bound the length. */
export function sanitizeErrorMessage(message: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: sanitizing is the point
	const cleaned = message.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
	return cleaned.length > MAX_MESSAGE_LENGTH
		? `${cleaned.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
		: cleaned;
}

/** Wire error shape produced by the Gateway (structurally validated). */
interface GatewayWireError {
	code: string;
	message: string;
	retryable?: boolean;
	correlationId?: string;
	details?: Record<string, unknown>;
}

function isGatewayWireError(value: unknown): value is GatewayWireError {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { code?: unknown }).code === "string" &&
		typeof (value as { message?: unknown }).message === "string"
	);
}

function actionForGatewayCode(
	code: string,
	message: string,
	retryable: boolean,
): DesktopErrorAction {
	switch (code) {
		case "gateway_unreachable":
			return "start_gateway";
		case "protocol_version_unsupported":
			return "update_client";
		case "run_admission_rejected":
			return /workspace/i.test(message)
				? "choose_workspace"
				: retryable
					? "retry"
					: "none";
		default:
			return retryable ? "retry" : "none";
	}
}

/** Map any thrown value onto exactly one `PublicDesktopError`. */
export function toPublicDesktopError(error: unknown): PublicDesktopError {
	// GatewayRequestError instances carry `gatewayError` — read it
	// structurally so this module never imports the Gateway package.
	const wire =
		typeof error === "object" &&
		error !== null &&
		isGatewayWireError((error as { gatewayError?: unknown }).gatewayError)
			? ((error as { gatewayError: GatewayWireError })
					.gatewayError as GatewayWireError)
			: isGatewayWireError(error)
				? error
				: undefined;
	if (wire) {
		const retryable = wire.retryable === true;
		const message = sanitizeErrorMessage(wire.message);
		return {
			code: wire.code,
			message,
			retryable,
			...(wire.correlationId ? { correlationId: wire.correlationId } : {}),
			action: actionForGatewayCode(wire.code, message, retryable),
		};
	}
	return {
		code: "desktop_internal",
		message: sanitizeErrorMessage(
			error instanceof Error ? error.message : String(error),
		),
		retryable: false,
		action: "none",
	};
}

export function desktopError(
	code: string,
	message: string,
	options: { retryable?: boolean; action?: DesktopErrorAction } = {},
): PublicDesktopError {
	return {
		code,
		message: sanitizeErrorMessage(message),
		retryable: options.retryable ?? false,
		action: options.action ?? "none",
	};
}
