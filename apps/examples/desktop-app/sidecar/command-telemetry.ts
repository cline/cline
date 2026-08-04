import {
	isTelemetryOptedOutGlobally,
	normalizeSdkError,
	type TelemetryProperties,
} from "@cline/core";
import { DESKTOP_COMMAND_FAILED_EVENT } from "./client-events";
import type { SidecarContext } from "./types";

/**
 * Sidecar-side command health telemetry — the server half of the webview's
 * `desktop.command_failed` instrumentation. A webview timeout only says the
 * sidecar didn't answer; these events say which command, how slow, and what
 * it threw.
 */

export const DESKTOP_COMMAND_SLOW_EVENT = "desktop.command_slow";

const SIDECAR_COMPONENT = "desktop.sidecar";

/** Success slower than this reports `desktop.command_slow`. */
export const SLOW_COMMAND_THRESHOLD_MS = 10_000;

/**
 * Commands that legitimately block far past the threshold; reporting them
 * as slow would be pure noise.
 */
const SLOW_EXEMPT_COMMANDS = new Set([
	// Blocks on the native folder picker until the user chooses.
	"pick_workspace_directory",
	// Blocks on a browser OAuth round-trip.
	"run_provider_oauth_login",
	// Chat turns are long-running by design (the webview opts out of its
	// deadline for these too).
	"chat_session_command",
]);

// Command names arrive over the transport, so clamp anything that is not
// one of our own snake_case identifiers to keep property cardinality sane.
const COMMAND_NAME_PATTERN = /^[a-z0-9_.]{1,64}$/;

function sanitizeCommandName(command: unknown): string {
	return typeof command === "string" && COMMAND_NAME_PATTERN.test(command)
		? command
		: "invalid_command_name";
}

/**
 * Records the outcome of one command dispatch. Failure reports
 * `desktop.command_failed`; slow success reports `desktop.command_slow`.
 * Never throws: this sits in the transport dispatch path.
 */
export function recordCommandOutcome(
	ctx: SidecarContext,
	command: unknown,
	durationMs: number,
	error?: unknown,
): void {
	try {
		if (!ctx.telemetry || isTelemetryOptedOutGlobally()) {
			return;
		}
		const properties: TelemetryProperties = {
			component: SIDECAR_COMPONENT,
			command: sanitizeCommandName(command),
			duration_ms: Math.max(0, Math.round(durationMs)),
		};
		if (error !== undefined) {
			ctx.telemetry.capture({
				event: DESKTOP_COMMAND_FAILED_EVENT,
				// normalizeSdkError supplies redacted/truncated error_type,
				// error_message (and error_code/error_status when present).
				properties: { ...properties, ...normalizeSdkError(error) },
			});
			return;
		}
		if (
			durationMs >= SLOW_COMMAND_THRESHOLD_MS &&
			!SLOW_EXEMPT_COMMANDS.has(String(command))
		) {
			ctx.telemetry.capture({
				event: DESKTOP_COMMAND_SLOW_EVENT,
				properties,
			});
		}
	} catch (captureError) {
		ctx.logger?.debug?.("Failed to record command outcome telemetry", {
			error: captureError,
		});
	}
}

/**
 * Times `run` and reports its outcome (failure or slow success) before
 * re-propagating the result to the transport layer.
 */
export async function dispatchCommandWithTelemetry(
	ctx: SidecarContext,
	command: unknown,
	run: () => Promise<unknown>,
): Promise<unknown> {
	const startedAt = Date.now();
	try {
		const result = await run();
		recordCommandOutcome(ctx, command, Date.now() - startedAt);
		return result;
	} catch (error) {
		recordCommandOutcome(ctx, command, Date.now() - startedAt, error);
		throw error;
	}
}
