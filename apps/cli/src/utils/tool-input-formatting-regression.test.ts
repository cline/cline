import { describe, expect, it } from "vitest";
import { formatToolInput, formatToolOutput } from "./helpers";

describe("tool input formatting regressions", () => {
	it("does not throw for a structured command with a null command", () => {
		expect(() =>
			formatToolInput("run_commands", { command: null }),
		).not.toThrow();
		expect(formatToolInput("run_commands", { command: null })).toBe("");
	});

	it("stringifies unexpected structured command values", () => {
		expect(
			formatToolInput("run_commands", {
				command: { nested: true },
				args: [null, "status"],
			}),
		).toBe('{"nested":true} status');
	});

	it("falls back safely when tool input cannot be JSON serialized", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;

		expect(() => formatToolInput("unknown_tool", circular)).not.toThrow();
		expect(formatToolInput("unknown_tool", circular)).toBe("[object Object]");
	});

	it("falls back safely when tool output cannot be JSON serialized", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;

		expect(() => formatToolOutput(circular)).not.toThrow();
		expect(formatToolOutput(circular)).toBe("[object Object]");
	});
});