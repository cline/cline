import { describe, expect, it } from "vitest";
import { formatRpcCallbackError } from "./helpers";

describe("formatRpcCallbackError", () => {
	it("includes stack for Error instances", () => {
		const err = new Error("boom");
		err.stack = "Error: boom\n  at test.js:1:1";
		const msg = formatRpcCallbackError(err);
		expect(msg).toContain("boom");
		expect(msg).toContain("at test.js");
	});

	it("stringifies non-Error values", () => {
		expect(formatRpcCallbackError({ code: 42 })).toBe("[object Object]");
	});

	it("appends Error.cause when present", () => {
		const root = new Error("root");
		const err = new Error("wrapper", { cause: root });
		const msg = formatRpcCallbackError(err);
		expect(msg).toContain("wrapper");
		expect(msg).toContain("Caused by:");
		expect(msg).toContain("root");
	});

	it("truncates very long output", () => {
		const err = new Error("x".repeat(5000));
		const msg = formatRpcCallbackError(err, 200);
		expect(msg.length).toBeLessThanOrEqual(220);
		expect(msg).toContain("...[truncated]");
	});
});
