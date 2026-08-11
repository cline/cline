import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	captureSdkError,
	normalizeSdkError,
	resetSdkErrorRateLimiterForTests,
	SDK_ERROR_RATE_LIMIT_MAX_PER_WINDOW,
	SDK_ERROR_RATE_LIMIT_WINDOW_MS,
	SDK_ERROR_TELEMETRY_EVENT,
} from "./telemetry";

beforeEach(() => {
	resetSdkErrorRateLimiterForTests();
});

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

	it("uses a stable fallback for errors without a message", () => {
		expect(normalizeSdkError(new Error("")).error_message).toBe(
			"Unknown error",
		);
		expect(normalizeSdkError([]).error_message).toBe("Unknown error");
		expect(normalizeSdkError({}).error_message).toBe("Unknown error");
	});

	it("prefers an explicitly extracted message while preserving raw metadata", () => {
		const normalized = normalizeSdkError(
			Object.assign(
				new Error("No output generated. Check the stream for errors."),
				{
					code: "invalid_request_error",
					statusCode: 400,
				},
			),
			undefined,
			"prompt is too long",
		);

		expect(normalized).toMatchObject({
			error_type: "Error",
			error_message: "prompt is too long",
			error_code: "invalid_request_error",
			error_status: 400,
		});
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

	it("drops undefined context values instead of exporting them", () => {
		const telemetry = {
			capture: vi.fn(),
		};

		captureSdkError(telemetry as never, {
			component: "agents",
			operation: "agent.run",
			error: new Error("boom"),
			context: {
				sessionId: "s1",
				providerId: undefined,
				modelId: undefined,
			},
		});

		const properties = telemetry.capture.mock.calls[0]?.[0]?.properties ?? {};
		expect(properties).toMatchObject({ sessionId: "s1" });
		expect("providerId" in properties).toBe(false);
		expect("modelId" in properties).toBe(false);
	});
});

describe("SDK error rate limiting", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	function captureRepeatedly(count: number, message: (i: number) => string) {
		const capture = vi.fn();
		for (let i = 0; i < count; i++) {
			captureSdkError({ capture } as never, {
				component: "llms",
				operation: "provider.stream",
				error: new Error(message(i)),
			});
		}
		return capture;
	}

	it("emits the first N identical failures per window, then suppresses", () => {
		const capture = captureRepeatedly(100, () => "Upstream returned HTTP 429");

		expect(capture).toHaveBeenCalledTimes(SDK_ERROR_RATE_LIMIT_MAX_PER_WINDOW);
	});

	it("does not suppress distinct failures", () => {
		const capture = captureRepeatedly(10, (i) => `distinct ${"x".repeat(i)}`);

		expect(capture).toHaveBeenCalledTimes(10);
	});

	it("coalesces messages that differ only by numbers", () => {
		const capture = captureRepeatedly(
			100,
			(i) => `run failed at iteration ${i}`,
		);

		expect(capture).toHaveBeenCalledTimes(SDK_ERROR_RATE_LIMIT_MAX_PER_WINDOW);
	});

	it("keeps failures with distinct error_status on separate budgets", () => {
		const capture = vi.fn();
		for (const status of [429, 401]) {
			for (let i = 0; i < 100; i++) {
				captureSdkError({ capture } as never, {
					component: "llms",
					operation: "provider.stream",
					error: Object.assign(new Error(`Upstream returned HTTP ${status}`), {
						status,
					}),
				});
			}
		}

		// A hot rate-limit loop must not consume the auth failure's budget.
		expect(capture).toHaveBeenCalledTimes(
			2 * SDK_ERROR_RATE_LIMIT_MAX_PER_WINDOW,
		);
		const statuses = capture.mock.calls.map(
			([call]) => call.properties.error_status,
		);
		expect(statuses.filter((status) => status === 429)).toHaveLength(
			SDK_ERROR_RATE_LIMIT_MAX_PER_WINDOW,
		);
		expect(statuses.filter((status) => status === 401)).toHaveLength(
			SDK_ERROR_RATE_LIMIT_MAX_PER_WINDOW,
		);
	});

	it("keeps failures with distinct error_code on separate budgets", () => {
		const capture = vi.fn();
		for (const code of ["rate_limit_error", "authentication_error"]) {
			for (let i = 0; i < 100; i++) {
				captureSdkError({ capture } as never, {
					component: "llms",
					operation: "provider.stream",
					error: Object.assign(new Error("request rejected"), { code }),
				});
			}
		}

		expect(capture).toHaveBeenCalledTimes(
			2 * SDK_ERROR_RATE_LIMIT_MAX_PER_WINDOW,
		);
	});

	it("returns whether the failure was recorded", () => {
		const capture = vi.fn();
		const input = {
			component: "llms",
			operation: "provider.stream",
			error: new Error("boom"),
		} as const;

		expect(captureSdkError(undefined, input)).toBe(false);
		expect(captureSdkError({ capture } as never, input)).toBe(true);
		// Rate-limit-suppressed failures still count as recorded.
		for (let i = 0; i < 100; i++) {
			expect(captureSdkError({ capture } as never, input)).toBe(true);
		}
	});

	it("carries suppressed_count onto the next emission after the window rolls over", () => {
		vi.useFakeTimers();
		const capture = captureRepeatedly(
			SDK_ERROR_RATE_LIMIT_MAX_PER_WINDOW + 7,
			() => "Upstream returned HTTP 429",
		);
		expect(capture).toHaveBeenCalledTimes(SDK_ERROR_RATE_LIMIT_MAX_PER_WINDOW);

		vi.advanceTimersByTime(SDK_ERROR_RATE_LIMIT_WINDOW_MS);
		captureSdkError({ capture } as never, {
			component: "llms",
			operation: "provider.stream",
			error: new Error("Upstream returned HTTP 429"),
		});

		expect(capture).toHaveBeenLastCalledWith({
			event: SDK_ERROR_TELEMETRY_EVENT,
			properties: expect.objectContaining({
				error_message: "Upstream returned HTTP 429",
				suppressed_count: 7,
			}),
		});
	});

	it("keeps a 12-hour hot loop bounded to dozens of events", () => {
		vi.useFakeTimers();
		const capture = vi.fn();

		// One identical failure every 10 seconds for 12 hours.
		for (let i = 0; i < (12 * SDK_ERROR_RATE_LIMIT_WINDOW_MS) / 10_000; i++) {
			captureSdkError({ capture } as never, {
				component: "llms",
				operation: "provider.stream",
				error: new Error("Upstream returned HTTP 429"),
			});
			vi.advanceTimersByTime(10_000);
		}

		expect(capture).toHaveBeenCalledTimes(
			12 * SDK_ERROR_RATE_LIMIT_MAX_PER_WINDOW,
		);
	});
});
