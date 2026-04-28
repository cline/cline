import { formatUserCommandBlock } from "@clinebot/shared";
import { describe, expect, it } from "vitest";
import {
	extractSlashQuery,
	formatMentionAutocompleteValue,
	getFirstSelectableIndex,
	insertMention,
} from "./use-autocomplete";

describe("TUI autocomplete slash command replacement", () => {
	it("detects a slash query immediately before the cursor", () => {
		expect(extractSlashQuery("/review")).toEqual({
			inSlashMode: true,
			query: "review",
			slashIndex: 0,
		});
		expect(extractSlashQuery("please /review")).toEqual({
			inSlashMode: true,
			query: "review",
			slashIndex: 7,
		});
	});

	it("uses the shared user command wrapper for skill/workflow replacement values", () => {
		expect(formatUserCommandBlock("Review carefully", "review")).toBe(
			'<user_command slash="review">Review carefully</user_command>',
		);
	});

	it("supports replacing only the slash token at the cursor", () => {
		const text = "please /review this file";
		const cursor = "please /review".length;
		const slash = extractSlashQuery(text.slice(0, cursor));
		const replacement = formatUserCommandBlock("Review carefully", "review");

		expect(slash.inSlashMode).toBe(true);
		if (!slash.inSlashMode) return;
		expect(
			text.slice(0, slash.slashIndex) + replacement + text.slice(cursor),
		).toBe(
			'please <user_command slash="review">Review carefully</user_command> this file',
		);
	});

	it("selects the first command option instead of a section header", () => {
		expect(
			getFirstSelectableIndex([
				{ display: "Skills", value: "", isHeader: true },
				{ display: "/review", value: "/review " },
			]),
		).toBe(1);
	});

	it("formats workspace mention completions as relative file mentions", () => {
		expect(formatMentionAutocompleteValue("src/main.ts")).toBe(
			"@./src/main.ts ",
		);
		expect(insertMention("open @src", 5, "src/main.ts")).toBe(
			"open @./src/main.ts ",
		);
	});

	it("preserves parser-compatible mention prefixes", () => {
		expect(formatMentionAutocompleteValue("/tmp/file.txt")).toBe(
			"@/tmp/file.txt ",
		);
		expect(formatMentionAutocompleteValue("~/file.txt")).toBe("@~/file.txt ");
		expect(formatMentionAutocompleteValue("./file.txt")).toBe("@./file.txt ");
		expect(formatMentionAutocompleteValue("../file.txt")).toBe("@../file.txt ");
	});

	it("quotes parser-compatible mention paths containing spaces", () => {
		expect(formatMentionAutocompleteValue("docs/my file.md")).toBe(
			'@"./docs/my file.md" ',
		);
		expect(insertMention("open @docs", 5, "docs/my file.md")).toBe(
			'open @"./docs/my file.md" ',
		);
	});
});
