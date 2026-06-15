import { describe, expect, it } from "vitest";
import {
	composeClineSystemPrompt,
	DEFAULT_CLINE_PERSONA,
	DEFAULT_CLINE_SYSTEM_PROMPT,
} from "./system";

// The canonical default system prompt. Pinned as a literal (including trailing
// whitespace) so accidental drift is caught; update deliberately when the
// default prompt is intentionally changed.
const EXPECTED_DEFAULT_CLINE_SYSTEM_PROMPT = `You are Cline, an AI coding agent. Your primary goal is to assist users with various coding tasks by leveraging your knowledge and the tools at your disposal. Given the user's prompt, you should use the tools available to you to answer user's question.

Always gather all the necessary context before starting to work on a task. For example, if you are generating a unit test or new code, make sure you understand the requirement, the naming conventions, frameworks and libraries used and aligned in the current codebase, and the environment and commands used to run and test the code etc. Always validate the new unit test at the end including running the code if possible for live feedback.
Review each question carefully and answer it with detailed, accurate information.

Environment you are running in:
<env>
1. Platform: {{PLATFORM_NAME}}
2. Date: {{CURRENT_DATE}}
3. IDE: {{IDE_NAME}}
4. Working Directory: {{CWD}}
</env>

Remember:
- If you need more information, use one of the available tools or ask for clarification instead of making assumptions or lies.
- Always adhere to existing code conventions and patterns.
- Use only libraries and frameworks that are confirmed to be in use in the current codebase.
- Provide complete and functional code without omissions or placeholders.
- Be explicit about any assumptions or limitations in your solution.
- Always show your planning process before executing any task. This will help ensure that you have a clear understanding of the requirements and that your approach aligns with the user's needs.
- Always use absolute paths when referring to files.
- Always verify the files you have edited or created at the end of the task to ensure they are completed and working as expected.

Begin by analyzing the user's input and gathering any necessary additional context. Then, present your plan at the start of your response along with tool calls before proceeding with the task. It's OK for this section to be quite long.

REMEMBER, be helpful and proactive! Don't ask for permission to do something when you can do it! Do not indicates you will be using a tool unless you are actually going to use it.

IMPORTANT: Always includes tool calls in your response until the task is completed. Response without tool calls will considered as completed with final answer.

When you have completed the task, please provide a summary of what you did and any relevant information that the user should know. This will help ensure that the user understands the changes made and can easily follow up if they have any questions or need further assistance. Do not indicate that you will perform an action without actually doing it. Always provide the final result in your response. Always validate your answer with checking the code and running it if possible.${" "}

If user asked a simple question without any coding context, answer it directly without using any tools.
{{CLINE_RULES}}
{{CLINE_METADATA}}`;

// Everything after the persona is the always-on harness (env block, working
// guidelines, tool-call contract, completion rules, rules/metadata). Derived
// from the default so the harness text has a single source of truth.
const HARNESS = EXPECTED_DEFAULT_CLINE_SYSTEM_PROMPT.slice(
	DEFAULT_CLINE_PERSONA.length,
);

describe("composeClineSystemPrompt", () => {
	it("composes the canonical default prompt", () => {
		expect(DEFAULT_CLINE_SYSTEM_PROMPT).toBe(
			EXPECTED_DEFAULT_CLINE_SYSTEM_PROMPT,
		);
		expect(composeClineSystemPrompt()).toBe(
			EXPECTED_DEFAULT_CLINE_SYSTEM_PROMPT,
		);
		expect(composeClineSystemPrompt({})).toBe(
			EXPECTED_DEFAULT_CLINE_SYSTEM_PROMPT,
		);
		// The exported persona is the real prefix; the rest is the harness.
		expect(DEFAULT_CLINE_SYSTEM_PROMPT).toBe(DEFAULT_CLINE_PERSONA + HARNESS);
	});

	it("treats a blank persona as the default", () => {
		expect(composeClineSystemPrompt({ persona: "   " })).toBe(
			EXPECTED_DEFAULT_CLINE_SYSTEM_PROMPT,
		);
	});

	it("swaps the persona but keeps the harness verbatim", () => {
		const persona =
			"You are Reviewer, a meticulous code review agent. Focus on correctness.";
		// Only the persona changes; the entire harness tail is byte-identical.
		expect(composeClineSystemPrompt({ persona })).toBe(persona + HARNESS);
	});

	it("keeps the working guidelines, incl. the no-guessing norm, in the harness", () => {
		const norm =
			"If you need more information, use one of the available tools or ask for clarification instead of making assumptions or lies.";
		// The norm and the rest of the working guidelines are harness, not
		// persona, so a profile keeps them while the identity is swapped.
		expect(HARNESS).toContain(norm);
		expect(DEFAULT_CLINE_PERSONA).not.toContain(norm);
	});

	it("inserts persona content literally, including replacement patterns", () => {
		const persona = "Echo the captured group $& and $' verbatim.";
		expect(composeClineSystemPrompt({ persona })).toBe(persona + HARNESS);
	});

	it("keeps template-like tokens inside the persona literal", () => {
		const persona = "Mention {{AGENT_GUIDELINES}} and {{AGENT_PERSONA}} as-is.";
		expect(composeClineSystemPrompt({ persona })).toBe(persona + HARNESS);
	});
});
