import { expect, test } from "bun:test";
import { parsePlannerOutput, withFailureLead } from "./output";

const row = (kind: string, prompt: string, reason = "because") => ({
	kind,
	prompt,
	reason,
});

test("rows keep the model's words, get the kind's label, and at most three survive", () => {
	const set = parsePlannerOutput(
		JSON.stringify({
			suggestions: [
				row("verify", "Run bun test src/a.test.ts."),
				row("review_diff", "Review the change to src/a.ts."),
				row("commit", "Commit the retry change with a message."),
				row("wrap_up", "Summarize the retry change for the PR."),
			],
		}),
	);
	expect(set?.map((item) => [item.kind, item.label])).toEqual([
		["verify", "Verify"],
		["review_diff", "Review"],
		["commit", "Commit"],
	]);
});

test("prose and a code fence around the JSON are ignored", () => {
	const set = parsePlannerOutput(
		`Sure!\n\`\`\`json\n${JSON.stringify({ suggestions: [row("verify", "Run bun test src/a.test.ts.")] })}\n\`\`\``,
	);
	expect(set).toHaveLength(1);
});

test("an answer cut off mid-row keeps the rows before the cut", () => {
	const complete = JSON.stringify(row("verify", "Run bun test src/a.test.ts."));
	const set = parsePlannerOutput(
		`{"suggestions":[${complete},{"kind":"review_diff","prompt":"Review the cha`,
	);
	expect(set?.map((item) => item.kind)).toEqual(["verify"]);
});

test("unknown kinds, short prompts, duplicates and non-objects are dropped", () => {
	const set = parsePlannerOutput(
		JSON.stringify({
			suggestions: [
				row("rm_rf", "Delete everything in the working tree."),
				row("verify", "ok"),
				"verify",
				row("verify", "Run bun test src/a.test.ts."),
				row("review_diff", "Run bun test src/a.test.ts."),
			],
		}),
	);
	expect(set?.map((item) => item.kind)).toEqual(["verify"]);
});

test("a prompt is one line of at most 200 characters, without wrapping quotes", () => {
	const long = `${"Review the change to src/a.ts ".repeat(20)}`;
	const set = parsePlannerOutput(
		JSON.stringify({
			suggestions: [
				row("review_diff", `"Run bun test\nsrc/a.test.ts."`),
				row("verify", long),
			],
		}),
	);
	expect(set?.[0]?.prompt).toBe("Run bun test src/a.test.ts.");
	expect(set?.[1]?.prompt.length).toBeLessThanOrEqual(200);
	expect(set?.[1]?.prompt).not.toContain("\n");
});

test("an answer with no usable row is a failure, not an empty set", () => {
	expect(parsePlannerOutput("Run the tests.")).toBeNull();
	expect(parsePlannerOutput('{"suggestions":[]}')).toBeNull();
	expect(
		parsePlannerOutput(JSON.stringify({ suggestions: [row("nope", "x")] })),
	).toBeNull();
});

test("after a failed turn the rules' lead goes first unless the model wrote one", () => {
	const rules = [
		{
			kind: "fix_failure" as const,
			label: "Fix",
			prompt: "Fix the failure from the last turn and run it again.",
			reason: "A command in the last turn failed.",
		},
	];
	const verify =
		parsePlannerOutput(
			JSON.stringify({
				suggestions: [row("verify", "Run bun test src/a.test.ts.")],
			}),
		) ?? [];
	const facts = {
		status: "completed",
		filesEdited: 1,
		toolErrored: true,
	} as const;
	expect(
		withFailureLead(verify, rules, facts).map((item) => item.kind),
	).toEqual(["fix_failure", "verify"]);
	const own =
		parsePlannerOutput(
			JSON.stringify({
				suggestions: [
					row("verify", "Run bun test src/a.test.ts."),
					row("fix_failure", "Fix the type error in src/a.ts and rerun tsc."),
				],
			}),
		) ?? [];
	expect(withFailureLead(own, rules, facts).map((item) => item.prompt)).toEqual(
		[
			"Fix the type error in src/a.ts and rerun tsc.",
			"Run bun test src/a.test.ts.",
		],
	);
	expect(
		withFailureLead(verify, rules, { ...facts, toolErrored: false }),
	).toEqual(verify);
});
