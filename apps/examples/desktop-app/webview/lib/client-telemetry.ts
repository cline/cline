"use client";

import {
	type DesktopCommandFailureReport,
	desktopClient,
	setDesktopCommandFailureListener,
} from "./desktop-client";

/**
 * Webview-side telemetry reporting. The webview holds no telemetry
 * credentials; every report is forwarded to the sidecar over the transport
 * via the `report_client_event` command (see sidecar/client-events.ts,
 * which owns the allowlist, size caps, and the telemetry opt-out gate).
 *
 * The moments these reports fire are exactly the moments the transport may
 * be down (timeouts, disconnects), so reports are buffered in a bounded
 * in-memory queue and flushed when the transport reconnects. A hard app
 * exit loses the buffer by design — process-death failures are covered by
 * the Rust shell's breadcrumb file instead.
 */

export const SDK_ERROR_EVENT = "sdk.error";
export const DESKTOP_COMMAND_FAILED_EVENT = "desktop.command_failed";

const MAX_QUEUED_REPORTS = 100;
const MAX_ERROR_MESSAGE_LENGTH = 500;
// Well under the default 120s command deadline: a report stuck behind a dead
// transport should fail fast and wait for the reconnect flush instead.
const REPORT_TIMEOUT_MS = 10_000;

type QueuedClientEvent = {
	event: string;
	properties: Record<string, string | number | boolean>;
};

const queue: QueuedClientEvent[] = [];
let flushing = false;
let installed = false;

export function reportClientEvent(
	event: string,
	properties: Record<string, string | number | boolean>,
): void {
	// Bounded buffer: drop the oldest report rather than growing forever
	// while the transport is down.
	if (queue.length >= MAX_QUEUED_REPORTS) {
		queue.shift();
	}
	queue.push({ event, properties });
	void flushQueuedClientEvents();
}

export async function flushQueuedClientEvents(): Promise<void> {
	if (flushing) {
		return;
	}
	flushing = true;
	try {
		while (queue.length > 0) {
			const next = queue[0];
			try {
				await desktopClient.invoke("report_client_event", next, {
					timeoutMs: REPORT_TIMEOUT_MS,
				});
			} catch {
				// Transport is down or the sidecar is unresponsive. Keep the
				// report queued; the reconnect hook retries the flush.
				return;
			}
			queue.shift();
		}
	} finally {
		flushing = false;
	}
}

function normalizeErrorForReport(error: unknown): {
	error_type: string;
	error_message: string;
} {
	const errorObject = error instanceof Error ? error : undefined;
	const record =
		typeof error === "object" && error !== null
			? (error as Record<string, unknown>)
			: undefined;
	const message =
		errorObject?.message ??
		(typeof record?.message === "string" ? record.message : undefined) ??
		(typeof error === "string" ? error : String(error));
	return {
		error_type:
			errorObject?.name?.trim() ||
			(typeof record?.name === "string" ? record.name : "") ||
			errorObject?.constructor?.name ||
			"Error",
		error_message: (message || "Unknown error").slice(
			0,
			MAX_ERROR_MESSAGE_LENGTH,
		),
	};
}

export function reportWebviewError(input: {
	operation: string;
	error: unknown;
	severity?: "debug" | "info" | "warn" | "error" | "fatal";
	handled?: boolean;
}): void {
	reportClientEvent(SDK_ERROR_EVENT, {
		operation: input.operation,
		severity: input.severity ?? "error",
		handled: input.handled ?? false,
		...normalizeErrorForReport(input.error),
	});
}

function reportCommandFailure(report: DesktopCommandFailureReport): void {
	reportClientEvent(DESKTOP_COMMAND_FAILED_EVENT, {
		command: report.command,
		duration_ms: report.durationMs,
		reason: report.reason,
		transport_state: report.transportState,
	});
}

/**
 * Installs the global error hooks (window "error" + "unhandledrejection"),
 * the desktop-client command-failure listener, and the reconnect flush.
 * Idempotent; returns a cleanup function.
 */
export function installWebviewErrorReporting(): () => void {
	if (typeof window === "undefined" || installed) {
		return () => {};
	}
	installed = true;

	const onError = (event: ErrorEvent) => {
		reportWebviewError({
			operation: "window.onerror",
			error: event.error ?? event.message,
			handled: false,
		});
	};
	const onUnhandledRejection = (event: PromiseRejectionEvent) => {
		reportWebviewError({
			operation: "unhandledrejection",
			error: event.reason,
			handled: false,
		});
	};
	window.addEventListener("error", onError);
	window.addEventListener("unhandledrejection", onUnhandledRejection);
	setDesktopCommandFailureListener(reportCommandFailure);
	const unsubscribeTransportState = desktopClient.subscribeTransportState(
		(state) => {
			if (state === "connected") {
				void flushQueuedClientEvents();
			}
		},
	);

	return () => {
		installed = false;
		window.removeEventListener("error", onError);
		window.removeEventListener("unhandledrejection", onUnhandledRejection);
		setDesktopCommandFailureListener(null);
		unsubscribeTransportState();
	};
}

/** Test-only: clears module-level state between vitest cases. */
export function resetClientTelemetryForTests(): void {
	queue.length = 0;
	flushing = false;
	installed = false;
}
