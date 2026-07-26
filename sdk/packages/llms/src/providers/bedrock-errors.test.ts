import { describe, expect, it } from "vitest";
import { sanitizeBedrockError } from "./bedrock-errors";

describe("sanitizeBedrockError", () => {
	it("preserves the AWS error code and request ID", () => {
		expect(
			sanitizeBedrockError({
				name: "AccessDeniedException",
				message: "Access denied",
				$metadata: { requestId: "request-123" },
			}),
		).toBe(
			"Bedrock access-denied: AWS denied access to the requested Bedrock resource. Error code: AccessDeniedException. Request ID: request-123",
		);
	});

	it("does not include credential-like error details", () => {
		const message = sanitizeBedrockError({
			code: "ExpiredTokenException",
			message:
				"The security token temporary-secret-value included in the request is expired",
			$metadata: { requestId: "request-456" },
		});

		expect(message).toContain("Error code: ExpiredTokenException.");
		expect(message).toContain("Request ID: request-456");
		expect(message).not.toContain("temporary-secret-value");
	});

	it("omits unsafe error codes", () => {
		const message = sanitizeBedrockError({
			code: "AccessDenied: secret=do-not-log",
			message: "Access denied",
		});

		expect(message).not.toContain("do-not-log");
	});
});
