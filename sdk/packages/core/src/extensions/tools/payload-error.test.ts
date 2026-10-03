import { describe, expect, it } from "vitest";
import { extractToolPayloadError } from "./payload-error";

describe("extractToolPayloadError", () => {
	it("returns the error verbatim for a single failed operation", () => {
		expect(
			extractToolPayloadError([
				{
					query: "/tmp/missing.txt",
					result: "",
					error:
						"Error reading file: ENOENT: no such file or directory, statx '/tmp/missing.txt'",
					success: false,
				},
			]),
		).toBe(
			"Error reading file: ENOENT: no such file or directory, statx '/tmp/missing.txt'",
		);
	});

	it("reports how many failed when every operation fails", () => {
		expect(
			extractToolPayloadError([
				{ query: "a", result: "", error: "boom a", success: false },
				{ query: "b", result: "", error: "boom b", success: false },
			]),
		).toBe("All 2 items failed: boom a (+1 more)");
	});

	it("distinguishes a partial failure from a total one", () => {
		expect(
			extractToolPayloadError([
				{ query: "a", result: "contents", success: true },
				{ query: "b", result: "", error: "boom b", success: false },
				{ query: "c", result: "contents", success: true },
			]),
		).toBe("1 of 3 items failed: boom b");
	});

	it("returns undefined when every operation succeeded", () => {
		expect(
			extractToolPayloadError([
				{ query: "a", result: "contents", success: true },
			]),
		).toBeUndefined();
	});

	it("falls back to the query when a failure carries no message", () => {
		expect(
			extractToolPayloadError([{ query: "a", result: "", success: false }]),
		).toBe("a: failed");
	});

	it("ignores payloads that are not operation results", () => {
		// MCP content blocks and plain text must not be mistaken for failures.
		expect(
			extractToolPayloadError([{ type: "text", text: "hello" }]),
		).toBeUndefined();
		expect(extractToolPayloadError("plain string")).toBeUndefined();
		expect(extractToolPayloadError([])).toBeUndefined();
		expect(extractToolPayloadError(undefined)).toBeUndefined();
	});
});
