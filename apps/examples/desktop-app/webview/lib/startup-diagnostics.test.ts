import { expect, it } from "vitest";
import {
	buildStartupReport,
	sanitizeStartupLine,
	startupErrorCode,
} from "./startup-diagnostics";

it("discards credentials before truncation and removes user paths", () => {
	for (const secret of [
		"Authorization: Bearer private-value",
		"ws://localhost/?approval_token=private-value",
		"api_key=private-value",
		`${"x".repeat(2000)} token=private-value`,
	])
		expect(sanitizeStartupLine(secret)).toBe("[Sensitive diagnostic omitted]");
	expect(
		sanitizeStartupLine(
			"Failed /Users/alice/project/file.ts and C:\\Users\\alice\\app.exe",
		),
	).not.toContain("alice");
	expect(sanitizeStartupLine("Unable to bind port 25463")).toBe(
		"Unable to bind port 25463",
	);
});
it("classifies causes without exporting arbitrary error text", () => {
	const error = new Error("secret=private-value", {
		cause: Object.assign(new Error("private"), { code: "EADDRINUSE" }),
	});
	expect(startupErrorCode(error)).toBe("EADDRINUSE");
	expect(startupErrorCode(new Error("secret=private-value"))).toBe(
		"INITIALIZATION_FAILED",
	);
	expect(
		startupErrorCode(
			Object.assign(new Error("private"), { name: "HubProbeTimeoutError" }),
		),
	).toBe("HUB_PROBE_TIMEOUT");
});
it("bounds report history and includes app metadata", () => {
	const failures = Array.from({ length: 12 }, (_, attempt) => ({
		at: "2026-01-01T00:00:00Z",
		stage: "hub" as const,
		elapsedMs: 30000,
		attempt,
		code: "STARTUP_TIMEOUT",
		diagnostics: [],
	}));
	const report = JSON.parse(buildStartupReport(failures, "MacIntel"));
	expect(report.failures).toHaveLength(8);
	expect(report.failures[0].attempt).toBe(4);
	expect(report.appVersion).toBeTruthy();
});
