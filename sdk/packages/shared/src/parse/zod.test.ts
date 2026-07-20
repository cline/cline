import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateWithZod } from "./zod";

const UnionSchema = z.union([
	z.object({ files: z.array(z.object({ path: z.string() })) }),
	z.string(),
]);

const ObjectSchema = z.object({
	path: z.string(),
	start_line: z.number().int().optional(),
});

const HINT = 'Expected input like: {"files": [{"path": "/abs/file.ts"}]}';

describe("validateWithZod", () => {
	it("returns parsed data on success", () => {
		expect(validateWithZod(UnionSchema, "/tmp/a.ts", { hint: HINT })).toBe(
			"/tmp/a.ts",
		);
	});

	it("appends the hint on root-level union failures", () => {
		expect(() =>
			validateWithZod(UnionSchema, { files: [42] }, { hint: HINT }),
		).toThrow(`✖ Invalid input. ${HINT}`);
	});

	it("omits the hint on field-level failures where the message is already specific", () => {
		let message = "";
		try {
			validateWithZod(
				ObjectSchema,
				{ path: "/tmp/a.ts", start_line: "3" },
				{ hint: HINT },
			);
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain("start_line");
		expect(message).not.toContain(HINT);
	});

	it("keeps the bare message when no hint is provided", () => {
		expect(() => validateWithZod(UnionSchema, { files: [42] })).toThrow(
			"✖ Invalid input",
		);
	});
});
