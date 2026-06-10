import { describe, expect, it } from "vitest";
import {
	composeClineSystemPrompt,
	DEFAULT_CLINE_PERSONA,
	DEFAULT_CLINE_SYSTEM_PROMPT,
	DEFAULT_CLINE_WORKING_GUIDELINES,
} from "./system";

// The exact default system prompt before the persona/harness split. The
// refactor must keep the default output byte-identical, including trailing
// whitespace, so this is pinned as a literal rather than recomposed.
const PRE_SPLIT_DEFAULT_CLINE_SYSTEM_PROMPT = `You are Cline, an AI coding agent. Your primary goal is to assist users with various coding tasks by leveraging your knowledge and the tools at your disposal. Given the user's prompt, you should use the tools available to you to answer user's question.

Always gather all the necessary context before starting to work on a task. For example, if you are generating a unit test or new code, make sure you understand the requirement, the naming conventions, frameworks and libraries used and aligned in the current codebase, and the environment and commands used to run and test the code etc. Always validate the new unit test at the end including running the code if possible for live feedback.
Review each question carefully and answer it with detailed, accurate information.
If you need more information, use one of the available tools or ask for clarification instead of making assumptions or lies.

Environment you are running in:
<env>
1. Platform: {{PLATFORM_NAME}}
2. Date: {{CURRENT_DATE}}
3. IDE: {{IDE_NAME}}
4. Working Directory: {{CWD}}
</env>

Remember:
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

When you have completed the task, please provide a summary of what you did and any relevant information that the user should know. This will help ensure that the user understands the changes made and can easily follow up if they have any questions or need further assistance. Do not indicate that you will perform an action without actually doing it. Always provide the final result in your response. Always validate your answer with checking the code and running it if possible. 

If user asked a simple question without any coding context, answer it directly without using any tools.
{{CLINE_RULES}}
{{CLINE_METADATA}}`;

describe("composeClineSystemPrompt", () => {
	it("produces a byte-identical default prompt after the persona/harness split", () => {
		expect(DEFAULT_CLINE_SYSTEM_PROMPT).toBe(
			PRE_SPLIT_DEFAULT_CLINE_SYSTEM_PROMPT,
		);
		expect(composeClineSystemPrompt()).toBe(
			PRE_SPLIT_DEFAULT_CLINE_SYSTEM_PROMPT,
		);
		expect(composeClineSystemPrompt({})).toBe(
			PRE_SPLIT_DEFAULT_CLINE_SYSTEM_PROMPT,
		);
	});

	it("treats a blank persona as the default", () => {
		expect(composeClineSystemPrompt({ persona: "   " })).toBe(
			PRE_SPLIT_DEFAULT_CLINE_SYSTEM_PROMPT,
		);
	});

	it("swaps the persona slot while keeping the harness", () => {
		const persona =
			"You are Reviewer, a meticulous code review agent. Focus on correctness.";
		const prompt = composeClineSystemPrompt({ persona });

		expect(prompt.startsWith(persona)).toBe(true);
		expect(prompt).toContain("Environment you are running in:");
		expect(prompt).toContain("4. Working Directory: {{CWD}}");
		expect(prompt).toContain(
			"IMPORTANT: Always includes tool calls in your response until the task is completed.",
		);
		expect(prompt).toContain("{{CLINE_RULES}}");
		expect(prompt).toContain("{{CLINE_METADATA}}");
		// Default coding persona and working guidelines are fully replaced.
		expect(prompt).not.toContain("You are Cline, an AI coding agent.");
		expect(prompt).not.toContain(DEFAULT_CLINE_WORKING_GUIDELINES);
		// The guidelines slot collapses cleanly: env block flows into the
		// harness reminders with a single blank line.
		expect(prompt).toContain("</env>\n\nREMEMBER, be helpful and proactive!");
	});

	it("inserts persona content literally, including replacement patterns", () => {
		const persona = "Echo the captured group $& and $' verbatim.";
		const prompt = composeClineSystemPrompt({ persona });
		expect(prompt.startsWith(persona)).toBe(true);
	});

	it("keeps template-like tokens inside the persona literal", () => {
		const persona = "Mention {{AGENT_GUIDELINES}} and {{AGENT_PERSONA}} as-is.";
		const prompt = composeClineSystemPrompt({ persona });
		expect(prompt.startsWith(persona)).toBe(true);
		// The harness guidelines slot still collapsed cleanly.
		expect(prompt).toContain("</env>\n\nREMEMBER, be helpful and proactive!");
	});

	it("keeps the exported default persona and guidelines in sync with the default prompt", () => {
		expect(DEFAULT_CLINE_SYSTEM_PROMPT).toContain(DEFAULT_CLINE_PERSONA);
		expect(DEFAULT_CLINE_SYSTEM_PROMPT).toContain(
			DEFAULT_CLINE_WORKING_GUIDELINES,
		);
	});
});
