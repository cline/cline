import { describe, expect, it } from "vitest";
import {
	desktopError,
	sanitizeErrorMessage,
	toPublicDesktopError,
} from "./errors";

describe("PublicDesktopError mapping", () => {
	it("maps gateway_unreachable to the start_gateway action", () => {
		const error = toPublicDesktopError({
			gatewayError: {
				code: "gateway_unreachable",
				message: "Cannot reach the Gateway",
				retryable: true,
			},
		});
		expect(error.code).toBe("gateway_unreachable");
		expect(error.action).toBe("start_gateway");
		expect(error.retryable).toBe(true);
	});

	it("maps protocol_version_unsupported to update_client", () => {
		const error = toPublicDesktopError({
			gatewayError: {
				code: "protocol_version_unsupported",
				message: "protocol 99 unsupported",
				retryable: false,
			},
		});
		expect(error.action).toBe("update_client");
		expect(error.retryable).toBe(false);
	});

	it("maps workspace admission rejections to choose_workspace", () => {
		const error = toPublicDesktopError({
			gatewayError: {
				code: "run_admission_rejected",
				message: "Session workspace /a cannot change to /b",
				retryable: false,
			},
		});
		expect(error.action).toBe("choose_workspace");
	});

	it("preserves correlation IDs and retryability", () => {
		const error = toPublicDesktopError({
			gatewayError: {
				code: "internal",
				message: "boom",
				retryable: true,
				correlationId: "corr_1",
			},
		});
		expect(error.correlationId).toBe("corr_1");
		expect(error.action).toBe("retry");
	});

	it("wraps arbitrary errors without leaking stacks", () => {
		const error = toPublicDesktopError(new Error("ENOENT /home/user/.secret"));
		expect(error.code).toBe("desktop_internal");
		expect(error.retryable).toBe(false);
		expect(JSON.stringify(error)).not.toContain("stack");
	});

	it("sanitizes control characters and bounds message length", () => {
		expect(sanitizeErrorMessage("bad\u0000\u001bmessage")).toBe("bad message");
		const long = sanitizeErrorMessage("x".repeat(10_000));
		expect(long.length).toBeLessThanOrEqual(512);
	});

	it("desktopError builds sanitized errors", () => {
		const error = desktopError("approval_already_resolved", "late\u0000answer");
		expect(error.message).toBe("late answer");
		expect(error.action).toBe("none");
	});
});
