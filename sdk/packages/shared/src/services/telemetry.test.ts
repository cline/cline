import { describe, expect, it, vi } from "vitest";
import {
	captureSdkError,
	normalizeSdkError,
	SDK_ERROR_TELEMETRY_EVENT,
} from "./telemetry";

describe("SDK error telemetry", () => {
	it("normalizes unknown errors with sanitized, bounded messages", () => {
		const normalized = normalizeSdkError(
			new Error(
				"request failed: authorization=Bearer abc123 /Users/beatrix/project C:\\Users\\beatrix\\project C:/Users/beatrix/project",
			),
		);

		expect(normalized.error_type).toBe("Error");
		expect(String(normalized.error_message)).toContain("[redacted]");
		expect(String(normalized.error_message)).not.toContain("beatrix");
		expect(String(normalized.error_message)).not.toContain("abc123");
	});

	it("bounds sanitized error messages", () => {
		const normalized = normalizeSdkError(new Error("x".repeat(100)), 48);

		expect(normalized.error_message).toHaveLength(48);
	});

	it("captures canonical SDK error events with context", () => {
		const telemetry = {
			capture: vi.fn(),
		};

		captureSdkError(telemetry as never, {
			component: "core",
			operation: "session.shutdown",
			error: Object.assign(new Error("boom"), { code: "EBOOM", status: 503 }),
			severity: "warn",
			context: {
				sessionId: "s1",
				component: "context",
				operation: "context.operation",
				severity: "fatal",
				handled: false,
				error_type: "ContextError",
				error_message: "unsanitized context message",
				error_code: "CONTEXT",
				error_status: 400,
			},
		});

		expect(telemetry.capture).toHaveBeenCalledWith({
			event: SDK_ERROR_TELEMETRY_EVENT,
			properties: expect.objectContaining({
				component: "core",
				operation: "session.shutdown",
				severity: "warn",
				handled: true,
				error_type: "Error",
				error_message: "boom",
				error_code: "EBOOM",
				error_status: 503,
				sessionId: "s1",
			}),
		});
	});
});
