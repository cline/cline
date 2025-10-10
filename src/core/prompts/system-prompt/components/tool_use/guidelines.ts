import { ModelFamily } from "@/shared/prompts"
import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../../types"

export const TOOL_USE_GUIDELINES_TEMPLATE_TEXT = `# Tool Use Guidelines

1. In <thinking> tags, assess what information you already have and what information you need to proceed with the task.
2. Choose the most appropriate tool based on the task and the tool descriptions provided. Assess if you need additional information to proceed, and which of the available tools would be most effective for gathering this information. For example using the list_files tool is more effective than running a command like \`ls\` in the terminal. It's critical that you think about each available tool and use the one that best fits the current step in the task.
3. If multiple actions are needed, use one tool at a time per message to accomplish the task iteratively, with each tool use being informed by the result of the previous tool use. Do not assume the outcome of any tool use. Each step must be informed by the previous step's result.
4. Formulate your tool use using the XML format specified for each tool.
5. After each tool use, the user will respond with the result of that tool use. This result will provide you with the necessary information to continue your task or make further decisions. This response may include:
  - Information about whether the tool succeeded or failed, along with any reasons for failure.
  - Linter errors that may have arisen due to the changes you made, which you'll need to address.
  - New terminal output in reaction to the changes, which you may need to consider or act upon.
  - Any other relevant feedback or information related to the tool use.
6. ALWAYS wait for user confirmation after each tool use before proceeding. Never assume the success of a tool use without explicit confirmation of the result from the user.

It is crucial to proceed step-by-step, waiting for the user's message after each tool use before moving forward with the task. This approach allows you to:
1. Confirm the success of each step before proceeding.
2. Address any issues or errors that arise immediately.
3. Adapt your approach based on new information or unexpected results.
4. Ensure that each action builds correctly on the previous ones.

By waiting for and carefully considering the user's response after each tool use, you can react accordingly and make informed decisions about how to proceed with the task. This iterative process helps ensure the overall success and accuracy of your work.`

const GPT5_TOOL_USE_GUIDELINES_TEMPLATE_TEXT = `# Tool Use Guidelines

1. Use <thinking> tags to reason about what you already know and what information you still need.
2. Pick the tool that best advances the task. Prefer tools like list_files or search_files over ad-hoc shell commands when they provide richer structure.
3. Call only one tool per message. Wait for the platform's response before deciding on the next step.
4. Use the platform's function-calling interface for tools. Do not attempt to format tool invocations in text.
5. The user will respond with the tool result (success, failure, errors, console output, etc.). Use that feedback to decide the next step.
6. Always wait for confirmation after each tool call. Never assume success without explicit feedback.

Progress is iterative: confirm each step, handle issues immediately, and adapt based on new information so each action builds on a confirmed foundation.`

export async function getToolUseGuidelinesSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const template =
		variant.family === ModelFamily.GPT_5 ? GPT5_TOOL_USE_GUIDELINES_TEMPLATE_TEXT : TOOL_USE_GUIDELINES_TEMPLATE_TEXT
	return new TemplateEngine().resolve(template, context, {})
}
