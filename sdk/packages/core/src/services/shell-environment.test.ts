import { describe, expect, it } from "vitest";
import {
	captureShellEnvironment,
	MAX_SHELL_ENVIRONMENT_BYTES,
	parseShellEnvironment,
	SHELL_ENVIRONMENT_ERRORS,
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
		[null, SHELL_ENVIRONMENT_ERRORS.object],
		[[], SHELL_ENVIRONMENT_ERRORS.object],
		["secret-sentinel", SHELL_ENVIRONMENT_ERRORS.object],
		[
			Object.fromEntries(
				Array.from({ length: 4097 }, (_, i) => [`KEY${i}`, "secret-sentinel"]),
			),
			SHELL_ENVIRONMENT_ERRORS.count,
		],
		[{ "": "secret-sentinel" }, SHELL_ENVIRONMENT_ERRORS.name],
		[{ "BAD=NAME": "secret-sentinel" }, SHELL_ENVIRONMENT_ERRORS.name],
		[{ "BAD\0NAME": "secret-sentinel" }, SHELL_ENVIRONMENT_ERRORS.name],
		[{ ["N".repeat(257)]: "secret-sentinel" }, SHELL_ENVIRONMENT_ERRORS.name],
		[{ CANARY: 42 }, SHELL_ENVIRONMENT_ERRORS.value],
		[{ CANARY: "secret-sentinel\0" }, SHELL_ENVIRONMENT_ERRORS.value],
		[
			{ CANARY: "x".repeat(MAX_SHELL_ENVIRONMENT_BYTES) },
			SHELL_ENVIRONMENT_ERRORS.bytes,
		],
	])("rejects invalid wire input with a distinct constant message and no contents (%#)", (value, message) => {
		let thrown: unknown;
		try {
			parseShellEnvironment(value);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).toBe(message);
		expect((thrown as Error).message).not.toMatch(
			/secret-sentinel|CANARY|KEY\d|BAD|N{10}/,
		);
	});
	it("keeps each failure class message distinct", () => {
		expect(new Set(Object.values(SHELL_ENVIRONMENT_ERRORS)).size).toBe(
			Object.keys(SHELL_ENVIRONMENT_ERRORS).length,
		);
	});
	it("handles prototype-like names as data", () => {
		const input = JSON.parse('{"__proto__":"canary"}');
		expect(parseShellEnvironment(input)?.__proto__).toBe("canary");
	});
});
