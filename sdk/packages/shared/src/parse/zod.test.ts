import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatZodError, validateWithZod } from "./zod";

const runCommandsInput = z.union([
	z.strictObject({ commands: z.array(z.string()) }),
	z.strictObject({ command: z.string() }),
	z.strictObject({ cmd: z.string() }),
	z.array(z.string()),
	z.string(),
]);

const messageOf = (run: () => unknown) => {
	try {
		run();
	} catch (error) {
		return (error as Error).message;
	}
	return "";
};

describe("validateWithZod", () => {
	it("names the rejected key when no union member accepts the input", () => {
		const message = messageOf(() =>
			validateWithZod(runCommandsInput, {
				arguments: '{"commands":["Get-Date"]}',
			}),
		);

		expect(message).not.toBe("✖ Invalid input");
		expect(message).toContain('Unrecognized key: "arguments"');
		expect(message).toContain("at commands");
	});

	it("keeps the member's field path for a union nested in an object", () => {
		const schema = z.object({ calls: z.array(runCommandsInput) });
		const message = messageOf(() =>
			validateWithZod(schema, { calls: [{ arguments: "x" }] }),
		);

		expect(message).toContain("at calls[0].commands");
	});

	it("leaves the message of a non-union schema unchanged", () => {
		const schema = z.strictObject({ path: z.string() });
		const message = messageOf(() => validateWithZod(schema, { file: "a" }));

		expect(message).toContain('✖ Unrecognized key: "file"');
		expect(message).toContain("→ at path");
	});
});

describe("formatZodError", () => {
	it("reports the first union member's issues", () => {
		const error = runCommandsInput.safeParse({ command: 42 }).error;
		if (!error) throw new Error("expected the input to fail validation");

		expect(formatZodError(error)).toContain("at commands");
	});
});
