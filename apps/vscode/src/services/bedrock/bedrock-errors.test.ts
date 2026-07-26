import { describe, expect, it } from "vitest"
import { mapBedrockDoctorError, redactBedrockDiagnostics } from "./bedrock-errors"

describe("Bedrock diagnostic redaction", () => {
	it("redacts credentials, security headers, identity ARNs, and signed query values", () => {
		const redacted = redactBedrockDiagnostics({
			aws_access_key_id: "AKIAABCDEFGHIJKLMNOP",
			aws_secret_access_key: "very-secret",
			aws_session_token: "temporary-session",
			Authorization: "AWS4-HMAC-SHA256 Credential=AKIAABCDEFGHIJKLMNOP/scope",
			"x-amz-security-token": "header-session",
			identity: "arn:aws:sts::123456789012:assumed-role/Admin/alice",
			endpoint: "https://example.test/?X-Amz-Signature=abcdef&token=sensitive&customSecret=hidden",
		})

		for (const secret of [
			"AKIAABCDEFGHIJKLMNOP",
			"very-secret",
			"temporary-session",
			"header-session",
			"assumed-role/Admin/alice",
			"abcdef",
			"sensitive",
			"hidden",
		]) {
			expect(redacted).not.toContain(secret)
		}
	})

	it("preserves structured AWS diagnostics without echoing credential-bearing details", () => {
		const error = Object.assign(new Error("AccessDenied for AKIAABCDEFGHIJKLMNOP"), {
			name: "AccessDeniedException",
			$metadata: { httpStatusCode: 403, requestId: "request-123" },
		})
		expect(
			mapBedrockDoctorError(error, {
				stage: "discoveringModels",
				service: "bedrock",
				operation: "ListFoundationModels",
			}),
		).toMatchObject({
			category: "authorization",
			awsCode: "AccessDeniedException",
			httpStatus: 403,
			requestId: "request-123",
		})
	})
})
