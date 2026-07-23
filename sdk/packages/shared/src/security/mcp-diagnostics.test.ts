import { describe, expect, it } from "vitest";
import { sanitizeMcpDiagnosticText } from "./mcp-diagnostics";

describe("sanitizeMcpDiagnosticText", () => {
	it.each([
		["Bearer bearer-secret", "Bearer [REDACTED]"],
		["Basic dXNlcjpwYXNzd29yZA==", "Basic [REDACTED]"],
		["Basic dXNlcjpwYXNz", "Basic [REDACTED]"],
		["Authorization: Basic dXNlcjpwYXNzd29yZA==", "Authorization: [REDACTED]"],
		["password=hunter2", "password=[REDACTED]"],
		["passwd: hunter2", "passwd: [REDACTED]"],
		['"secret": "hidden"', '"secret": "[REDACTED]"'],
		[
			'{"password":"correct horse battery staple"}',
			'{"password":"[REDACTED]"}',
		],
		["secret: top secret value", "secret: [REDACTED]"],
		[
			'Authorization: "Digest username=alice, response=deadbeef"',
			'Authorization: "[REDACTED]"',
		],
		[
			"Authorization: Digest username=alice, response=deadbeef",
			"Authorization: [REDACTED]",
		],
		[
			'{"Authorization":"Bearer header-secret","status":401}',
			'{"Authorization":"[REDACTED]","status":401}',
		],
		["oauth_state=oauth-state", "oauth_state=[REDACTED]"],
		["authorization_code: oauth-code", "authorization_code: [REDACTED]"],
		["session_token=session-secret", "session_token=[REDACTED]"],
		["Cookie: session=secret; tenant=acme", "Cookie: [REDACTED]"],
		[
			"invalid credential eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
			"invalid credential [REDACTED JWT]",
		],
	])("redacts %s", (input, expected) => {
		expect(sanitizeMcpDiagnosticText(input)).toBe(expected);
	});

	it("strips credentials embedded in URLs", () => {
		expect(
			sanitizeMcpDiagnosticText(
				"Request to https://alice:password@mcp.example.com/connect failed",
			),
		).toBe("Request to https://mcp.example.com/connect failed");
	});

	it("marks URL query and hash redaction independently", () => {
		expect(
			sanitizeMcpDiagnosticText(
				"https://mcp.example.com/connect?tenant=acme#oauth-state",
			),
		).toBe("https://mcp.example.com/connect?[REDACTED]#[REDACTED]");
		expect(
			sanitizeMcpDiagnosticText("https://mcp.example.com/connect#oauth-state"),
		).toBe("https://mcp.example.com/connect#[REDACTED]");
	});

	it("is idempotent when diagnostics cross multiple boundaries", () => {
		const input =
			"Request https://alice:password@mcp.example.com/connect?state=secret failed with Bearer bearer-secret password=hunter2";
		const sanitized = sanitizeMcpDiagnosticText(input);

		expect(sanitizeMcpDiagnosticText(sanitized)).toBe(sanitized);
	});

	it("preserves non-sensitive diagnostic context", () => {
		expect(
			sanitizeMcpDiagnosticText(
				"OAuth request to https://auth.example.com/token failed with status 500",
			),
		).toBe(
			"OAuth request to https://auth.example.com/token failed with status 500",
		);
		expect(sanitizeMcpDiagnosticText("Basic authentication failed")).toBe(
			"Basic authentication failed",
		);
		expect(sanitizeMcpDiagnosticText("HTTP error code: 404")).toBe(
			"HTTP error code: 404",
		);
		expect(sanitizeMcpDiagnosticText("Process exited with code: 1")).toBe(
			"Process exited with code: 1",
		);
		expect(sanitizeMcpDiagnosticText("connection state: disconnected")).toBe(
			"connection state: disconnected",
		);
	});
});
