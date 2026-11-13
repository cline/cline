import { describe, expect, it } from "vitest";
import { getEditorSizeError } from "./helpers";
import { EditFileInputSchema, INPUT_ARG_CHAR_LIMIT } from "./schemas";

const oversized = "x".repeat(INPUT_ARG_CHAR_LIMIT + 1);
const atLimit = "x".repeat(INPUT_ARG_CHAR_LIMIT);

describe("getEditorSizeError", () => {
	it("accepts text at the limit", () => {
		expect(
			getEditorSizeError({ path: "/tmp/a.ts", new_text: atLimit }),
		).toBeNull();
		expect(
			getEditorSizeError({
				path: "/tmp/a.ts",
				old_text: atLimit,
				new_text: atLimit,
			}),
		).toBeNull();
	});

	it("states the limit as enforced and that a resend fails again", () => {
		const error = getEditorSizeError({
			path: "/tmp/a.ts",
			new_text: oversized,
		});
		expect(error).toContain(`limit of ${INPUT_ARG_CHAR_LIMIT}`);
		expect(error).not.toContain("recommended");
		expect(error).toContain("The file was not changed.");
		expect(error).toContain("rejected again");
	});

	it("tells a file creation to append the remaining parts at EOF", () => {
		const error = getEditorSizeError({
			path: "/tmp/a.ts",
			new_text: oversized,
		});
		expect(error).toContain("Create the file with the first part");
		expect(error).toContain("line count + 1");
	});

	it("tells an insertion to split into several inserts", () => {
		const error = getEditorSizeError({
			path: "/tmp/a.ts",
			new_text: oversized,
			insert_line: 10,
		});
		expect(error).toContain("Insert the text in several calls");
		expect(error).not.toContain("Create the file");
	});

	it("tells a replacement with oversized new_text to replace less first", () => {
		const error = getEditorSizeError({
			path: "/tmp/a.ts",
			old_text: "short",
			new_text: oversized,
		});
		expect(error).toContain("Replace a smaller old_text first");
	});

	it("tells a replacement with oversized old_text to use smaller edits", () => {
		const error = getEditorSizeError({
			path: "/tmp/a.ts",
			old_text: oversized,
			new_text: "short",
		});
		expect(error).toContain("old_text was");
		expect(error).toContain("several smaller edits");
	});
});

describe("EditFileInputSchema descriptions", () => {
	it("describe the size limit as enforced, not advisory", () => {
		const shape = EditFileInputSchema.shape;
		for (const field of [shape.old_text, shape.new_text]) {
			expect(field.description).toContain(
				`at most ${INPUT_ARG_CHAR_LIMIT} characters`,
			);
			expect(field.description).toContain("rejected");
			expect(field.description).not.toContain("when possible");
		}
	});
});
