import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../../types"

const TOOL_USE_GUIDELINES_TEMPLATE_TEXT = (context: SystemPromptContext) => `# Tool Use Guidelines

1. In <thinking> tags, assess what information you already have and what information you need to proceed with the task.
2. Choose the most appropriate tool based on the task and the tool descriptions provided. Assess if you need additional information to proceed, and which of the available tools would be most effective for gathering this information. For example using the list_files tool is more effective than running a command like \`ls\` in the terminal. It's critical that you think about each available tool and use the one that best fits the current step in the task.
3. ${context.enableParallelToolCalling ? "If multiple independent actions are needed, batch them into a single message so they can be executed in parallel. If one action depends on another action's result, use tools sequentially." : "If multiple actions are needed, use one tool at a time per message to accomplish the task iteratively, with each tool use being informed by the result of the previous tool use."} Do not assume the outcome of any tool use. Each dependent step must be informed by the previous step's result.
4. Formulate your tool use using the XML format specified for each tool.
5. After each tool use, the user will respond with the result of that tool use. This result will provide you with the necessary information to continue your task or make further decisions. This response may include:
  - Information about whether the tool succeeded or failed, along with any reasons for failure.
  - Linter errors that may have arisen due to the changes you made, which you'll need to address.
  - New terminal output in reaction to the changes, which you may need to consider or act upon.
  - Any other relevant feedback or information related to the tool use.
6. After a tool message is executed, wait for the returned tool results before taking the next dependent step. Never assume the success of a tool use without explicit confirmation of the result.

It is crucial to let each executed tool message complete before moving forward with the next dependent step. This approach allows you to:
1. Confirm the success of each step before proceeding.
2. Address any issues or errors that arise immediately.
3. Adapt your approach based on new information or unexpected results.
4. Ensure that each action builds correctly on the previous ones.

By waiting for and carefully considering the tool results after each executed tool message, you can react accordingly and make informed decisions about how to proceed with the task. This iterative process helps ensure the overall success and accuracy of your work.`

export async function getToolUseGuidelinesSection(_variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	return new TemplateEngine().resolve(TOOL_USE_GUIDELINES_TEMPLATE_TEXT(context), context, {})
}
