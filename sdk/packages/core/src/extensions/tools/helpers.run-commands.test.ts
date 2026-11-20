import { zodToJsonSchema } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { normalizeRunCommandsInput } from "./helpers";
import { RunCommandsInputSchema } from "./schemas";

describe("normalizeRunCommandsInput", () => {
	it("accepts the documented shapes", () => {
		expect(normalizeRunCommandsInput({ commands: ["ls", "pwd"] })).toEqual([
			"ls",
			"pwd",
		]);
		expect(normalizeRunCommandsInput({ commands: "ls" })).toEqual(["ls"]);
		expect(normalizeRunCommandsInput(["ls"])).toEqual(["ls"]);
		expect(normalizeRunCommandsInput("ls")).toEqual(["ls"]);
		expect(normalizeRunCommandsInput({ command: "ls" })).toEqual(["ls"]);
		expect(
			normalizeRunCommandsInput({ command: "git", args: ["status"] }),
		).toEqual([{ command: "git", args: ["status"] }]);
	});

	it("unwraps a commands array that the model sent as a JSON string", () => {
		expect(normalizeRunCommandsInput({ commands: '["dir"]' })).toEqual(["dir"]);
		expect(normalizeRunCommandsInput('["cd /tmp", "ls -la"]')).toEqual([
			"cd /tmp",
			"ls -la",
		]);
		expect(
			normalizeRunCommandsInput({
				commands: '[{"command":"git","args":["status"]}]',
			}),
		).toEqual([{ command: "git", args: ["status"] }]);
	});

	it("leaves shell text that only looks like a JSON array alone", () => {
		expect(normalizeRunCommandsInput({ commands: '[int]"42" + 1' })).toEqual([
			'[int]"42" + 1',
		]);
		expect(normalizeRunCommandsInput({ commands: "[1,2]" })).toEqual(["[1,2]"]);
	});

	it.each([
		{ label: "an object with an empty commands list", input: { commands: [] } },
		{ label: "a bare empty list", input: [] },
	])("rejects $label instead of reporting an empty success", ({ input }) => {
		expect(() => normalizeRunCommandsInput(input)).toThrow(
			"run_commands requires at least one command",
		);
	});
});

describe("RunCommandsInputSchema", () => {
	it("advertises the command list as non-empty", () => {
		const schema = zodToJsonSchema(RunCommandsInputSchema) as {
			properties: { commands: { minItems?: number } };
		};
		expect(schema.properties.commands.minItems).toBe(1);
	});
});
