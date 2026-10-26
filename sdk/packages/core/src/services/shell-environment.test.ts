import { describe, expect, it } from "vitest";
import {
	captureShellEnvironment,
	MAX_SHELL_ENVIRONMENT_BYTES,
	parseShellEnvironment,
} from "./shell-environment";

describe("session shell environment validation", () => {
	it("copies an explicit snapshot and preserves empty values and absent keys", () => {
		const input = { CANARY: "first", EMPTY: "", ABSENT: undefined };
		const copy = captureShellEnvironment(input);
		input.CANARY = "second";
		expect(copy).toEqual({ CANARY: "first", EMPTY: "" });
		expect(Object.isFrozen(copy)).toBe(true);
		expect(parseShellEnvironment(undefined)).toBeUndefined();
		expect(parseShellEnvironment({})).toEqual({});
	});
	it.each([
		null,
		[],
		"secret-sentinel",
		{ CANARY: 42 },
		{ "": "secret-sentinel" },
		{ "BAD=NAME": "secret-sentinel" },
		{ "BAD\0NAME": "secret-sentinel" },
		{ CANARY: "secret-sentinel\0" },
		{ CANARY: "x".repeat(MAX_SHELL_ENVIRONMENT_BYTES) },
		Object.fromEntries(
			Array.from({ length: 4097 }, (_, i) => [`KEY${i}`, "secret-sentinel"]),
		),
	])("rejects invalid wire input without echoing contents (%#)", (value) => {
		expect(() => parseShellEnvironment(value)).toThrow(
			/^Invalid session shell environment\.$/,
		);
	});
	it("handles prototype-like names as data", () => {
		const input = JSON.parse('{"__proto__":"canary"}');
		expect(parseShellEnvironment(input)?.__proto__).toBe("canary");
	});
});
