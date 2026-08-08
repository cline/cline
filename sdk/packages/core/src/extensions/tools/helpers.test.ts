import { describe, expect, it } from "vitest";
import { normalizeRunCommandsInput } from "./helpers";

describe("normalizeRunCommandsInput", () => {
	it("passes through a normal commands array", () => {
		expect(normalizeRunCommandsInput({ commands: ["ls", "pwd"] })).toEqual([
			"ls",
			"pwd",
		]);
	});

	it("unwraps a stringified JSON array in commands", () => {
		expect(
			normalizeRunCommandsInput({
				commands: '["find /tmp -maxdepth 1","echo ok"]',
			}),
		).toEqual(["find /tmp -maxdepth 1", "echo ok"]);
	});

	it("unwraps a one-element array whose sole entry is a stringified array", () => {
		expect(
			normalizeRunCommandsInput({
				commands: ['["echo a","echo b"]'],
			}),
		).toEqual(["echo a", "echo b"]);
	});

	it("leaves a legitimate single command that starts with [ alone", () => {
		expect(
			normalizeRunCommandsInput({
				commands: ["[ -f /tmp/x ] && echo yes"],
			}),
		).toEqual(["[ -f /tmp/x ] && echo yes"]);
	});
});
