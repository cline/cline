import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SidecarContext } from "./types";

const mocks = vi.hoisted(() => ({
	isTelemetryOptedOutGlobally: vi.fn(() => false),
}));

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		isTelemetryOptedOutGlobally: mocks.isTelemetryOptedOutGlobally,
	};
});

import { handleReportClientEvent } from "./client-events";

function createContext(overrides: Partial<SidecarContext> = {}): {
	ctx: SidecarContext;
	capture: ReturnType<typeof vi.fn>;
} {
	const capture = vi.fn();
	const ctx = {
		telemetry: { capture },
		logger: { log: vi.fn(), debug: vi.fn(), error: vi.fn() },
		...overrides,
	} as unknown as SidecarContext;
	return { ctx, capture };
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.isTelemetryOptedOutGlobally.mockReturnValue(false);
});

describe("handleReportClientEvent", () => {
	it("ignores events outside the allowlist", () => {
		const { ctx, capture } = createContext();
		expect(
			handleReportClientEvent(ctx, {
				event: "task.completed",
				properties: { provider: "spoofed" },
			}),
		).toEqual({ reported: false });
		expect(handleReportClientEvent(ctx, { event: "", properties: {} })).toEqual(
			{ reported: false },
		);
		expect(handleReportClientEvent(ctx, undefined)).toEqual({
			reported: false,
		});
		expect(capture).not.toHaveBeenCalled();
	});

	it("forwards sdk.error with a forced component and drops unknown fields", () => {
		const { ctx, capture } = createContext();
		const result = handleReportClientEvent(ctx, {
			event: "sdk.error",
			properties: {
				operation: "window.onerror",
				error_type: "TypeError",
				error_message: "boom",
				severity: "fatal",
				handled: true,
				component: "spoofed.component",
				distinct_id: "spoofed",
				extra_payload: { nested: "data" },
			},
		});
		expect(result).toEqual({ reported: true });
		expect(capture).toHaveBeenCalledTimes(1);
		const captured = capture.mock.calls[0][0];
		expect(captured.event).toBe("sdk.error");
		expect(captured.properties).toEqual({
			operation: "window.onerror",
			error_type: "TypeError",
			error_message: "boom",
			severity: "fatal",
			handled: true,
			component: "desktop.webview",
		});
	});

	it("caps oversized strings and redacts secrets via the shared normalizer", () => {
		const { ctx, capture } = createContext();
		handleReportClientEvent(ctx, {
			event: "sdk.error",
			properties: {
				operation: "unhandledrejection",
				error_type: "Error",
				error_message: `api_key=super-secret-token ${"x".repeat(2_000)}`,
			},
		});
		const properties = capture.mock.calls[0][0].properties;
		expect(properties.error_message).toContain("api_key=[redacted]");
		expect(properties.error_message).not.toContain("super-secret-token");
		expect(String(properties.error_message).length).toBeLessThanOrEqual(500);
	});

	it("defaults malformed sdk.error fields instead of trusting the webview", () => {
		const { ctx, capture } = createContext();
		handleReportClientEvent(ctx, {
			event: "sdk.error",
			properties: {
				operation: 42,
				severity: "catastrophic",
				handled: "yes",
			},
		});
		const properties = capture.mock.calls[0][0].properties;
		expect(properties.operation).toBe("unknown");
		expect(properties.severity).toBe("error");
		expect(properties.handled).toBe(false);
	});

	it("forwards desktop.command_failed and clamps command name and reason", () => {
		const { ctx, capture } = createContext();
		handleReportClientEvent(ctx, {
			event: "desktop.command_failed",
			properties: {
				command: "get_process_context",
				duration_ms: 120_000,
				reason: "timeout",
				transport_state: "reconnecting",
			},
		});
		expect(capture.mock.calls[0][0].properties).toEqual({
			command: "get_process_context",
			duration_ms: 120_000,
			reason: "timeout",
			transport_state: "reconnecting",
			component: "desktop.webview",
		});

		handleReportClientEvent(ctx, {
			event: "desktop.command_failed",
			properties: {
				command: "DROP TABLE; --",
				duration_ms: Number.POSITIVE_INFINITY,
				reason: "made-up-reason",
			},
		});
		const clamped = capture.mock.calls[1][0].properties;
		expect(clamped.command).toBe("invalid_command_name");
		expect(clamped.reason).toBe("error");
		expect(clamped).not.toHaveProperty("duration_ms");
	});

	it("gates on the global telemetry opt-out at capture time", () => {
		const { ctx, capture } = createContext();
		mocks.isTelemetryOptedOutGlobally.mockReturnValue(true);
		expect(
			handleReportClientEvent(ctx, {
				event: "sdk.error",
				properties: { operation: "window.onerror" },
			}),
		).toEqual({ reported: false });
		expect(capture).not.toHaveBeenCalled();
	});

	it("reports false without a telemetry handle", () => {
		const { ctx, capture } = createContext({ telemetry: undefined });
		expect(
			handleReportClientEvent(ctx, {
				event: "sdk.error",
				properties: { operation: "window.onerror" },
			}),
		).toEqual({ reported: false });
		expect(capture).not.toHaveBeenCalled();
	});

	it("never throws, even when capture itself throws", () => {
		const { ctx, capture } = createContext();
		capture.mockImplementation(() => {
			throw new Error("exporter exploded");
		});
		expect(
			handleReportClientEvent(ctx, {
				event: "sdk.error",
				properties: { operation: "window.onerror" },
			}),
		).toEqual({ reported: false });
	});

	it("tolerates non-object properties payloads", () => {
		const { ctx, capture } = createContext();
		expect(
			handleReportClientEvent(ctx, {
				event: "sdk.error",
				properties: ["not", "a", "record"],
			}),
		).toEqual({ reported: true });
		const properties = capture.mock.calls[0][0].properties;
		expect(properties.component).toBe("desktop.webview");
		expect(properties.operation).toBe("unknown");
	});
});
