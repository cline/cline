// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	subscribeTransportState: vi.fn(() => () => {}),
	setDesktopCommandFailureListener: vi.fn(),
}));

vi.mock("./desktop-client", () => ({
	desktopClient: {
		invoke: mocks.invoke,
		subscribeTransportState: mocks.subscribeTransportState,
	},
	setDesktopCommandFailureListener: mocks.setDesktopCommandFailureListener,
}));

import {
	DESKTOP_COMMAND_FAILED_EVENT,
	flushQueuedClientEvents,
	installWebviewErrorReporting,
	reportClientEvent,
	reportWebviewError,
	resetClientTelemetryForTests,
	SDK_ERROR_EVENT,
} from "./client-telemetry";

function sentEvents(): Array<{
	event: string;
	properties: Record<string, unknown>;
}> {
	return mocks.invoke.mock.calls.map((call) => call[1]);
}

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	resetClientTelemetryForTests();
	mocks.invoke.mockResolvedValue({ reported: true });
});

afterEach(() => {
	resetClientTelemetryForTests();
});

describe("reportClientEvent", () => {
	it("forwards reports through report_client_event with a short deadline", async () => {
		reportClientEvent(SDK_ERROR_EVENT, { operation: "window.onerror" });
		await settle();
		expect(mocks.invoke).toHaveBeenCalledTimes(1);
		expect(mocks.invoke).toHaveBeenCalledWith(
			"report_client_event",
			{
				event: SDK_ERROR_EVENT,
				properties: { operation: "window.onerror" },
			},
			{ timeoutMs: 10_000 },
		);
	});

	it("keeps reports queued while the transport is down and flushes them in order on reconnect", async () => {
		mocks.invoke.mockRejectedValue(new Error("transport unavailable"));
		reportClientEvent(SDK_ERROR_EVENT, { operation: "first" });
		reportClientEvent(SDK_ERROR_EVENT, { operation: "second" });
		await settle();
		// One delivery attempt failed; nothing was dequeued.
		expect(mocks.invoke).toHaveBeenCalledTimes(1);

		mocks.invoke.mockClear();
		mocks.invoke.mockResolvedValue({ reported: true });
		await flushQueuedClientEvents();
		expect(sentEvents().map((e) => e.properties.operation)).toEqual([
			"first",
			"second",
		]);
	});

	it("bounds the buffer to the last 100 reports", async () => {
		mocks.invoke.mockRejectedValue(new Error("down"));
		for (let index = 0; index < 150; index++) {
			reportClientEvent(SDK_ERROR_EVENT, { operation: `op-${index}` });
		}
		await settle();

		mocks.invoke.mockClear();
		mocks.invoke.mockResolvedValue({ reported: true });
		await flushQueuedClientEvents();
		const operations = sentEvents().map((e) => e.properties.operation);
		expect(operations).toHaveLength(100);
		expect(operations[0]).toBe("op-50");
		expect(operations.at(-1)).toBe("op-149");
	});

	it("does not run two flush loops concurrently", async () => {
		let resolveFirst: (() => void) | undefined;
		mocks.invoke.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveFirst = resolve;
				}),
		);
		reportClientEvent(SDK_ERROR_EVENT, { operation: "slow" });
		reportClientEvent(SDK_ERROR_EVENT, { operation: "queued" });
		await settle();
		expect(mocks.invoke).toHaveBeenCalledTimes(1);
		resolveFirst?.();
		await settle();
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
	});
});

describe("reportWebviewError", () => {
	it("normalizes Error instances and truncates messages", async () => {
		reportWebviewError({
			operation: "react_error_boundary",
			error: Object.assign(new TypeError("x".repeat(2_000)), {}),
			severity: "fatal",
			handled: true,
		});
		await settle();
		const [sent] = sentEvents();
		expect(sent.event).toBe(SDK_ERROR_EVENT);
		expect(sent.properties.operation).toBe("react_error_boundary");
		expect(sent.properties.error_type).toBe("TypeError");
		expect(String(sent.properties.error_message)).toHaveLength(500);
		expect(sent.properties.severity).toBe("fatal");
		expect(sent.properties.handled).toBe(true);
	});

	it("tolerates non-Error rejection reasons", async () => {
		reportWebviewError({ operation: "unhandledrejection", error: "plain" });
		await settle();
		const [sent] = sentEvents();
		expect(sent.properties.error_type).toBe("Error");
		expect(sent.properties.error_message).toBe("plain");
		expect(sent.properties.handled).toBe(false);
	});
});

describe("installWebviewErrorReporting", () => {
	it("reports window error events", async () => {
		const cleanup = installWebviewErrorReporting();
		window.dispatchEvent(
			new ErrorEvent("error", { error: new Error("render exploded") }),
		);
		await settle();
		const [sent] = sentEvents();
		expect(sent.event).toBe(SDK_ERROR_EVENT);
		expect(sent.properties.operation).toBe("window.onerror");
		expect(sent.properties.error_message).toBe("render exploded");
		cleanup();
	});

	it("registers the command failure listener and flushes on reconnect", async () => {
		const cleanup = installWebviewErrorReporting();
		expect(mocks.setDesktopCommandFailureListener).toHaveBeenCalledTimes(1);
		const listener = mocks.setDesktopCommandFailureListener.mock.calls[0][0];
		listener({
			command: "get_process_context",
			durationMs: 120_000,
			reason: "timeout",
			transportState: "connected",
		});
		await settle();
		const [sent] = sentEvents();
		expect(sent.event).toBe(DESKTOP_COMMAND_FAILED_EVENT);
		expect(sent.properties).toEqual({
			command: "get_process_context",
			duration_ms: 120_000,
			reason: "timeout",
			transport_state: "connected",
		});

		// Reconnect hook triggers a flush of anything still queued.
		mocks.invoke.mockRejectedValueOnce(new Error("down"));
		listener({
			command: "list_chat_sessions",
			durationMs: 5,
			reason: "transport_unavailable",
			transportState: "reconnecting",
		});
		await settle();
		const transportHandler = mocks.subscribeTransportState.mock
			.calls[0][0] as unknown as (state: string) => void;
		mocks.invoke.mockClear();
		mocks.invoke.mockResolvedValue({ reported: true });
		transportHandler("connected");
		await settle();
		expect(sentEvents().map((e) => e.properties.command)).toEqual([
			"list_chat_sessions",
		]);
		cleanup();
	});

	it("is idempotent and uninstalls cleanly", () => {
		const cleanup = installWebviewErrorReporting();
		const second = installWebviewErrorReporting();
		expect(mocks.setDesktopCommandFailureListener).toHaveBeenCalledTimes(1);
		second();
		cleanup();
		expect(mocks.setDesktopCommandFailureListener).toHaveBeenLastCalledWith(
			null,
		);
	});
});
