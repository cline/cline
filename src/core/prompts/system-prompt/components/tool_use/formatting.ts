import { ModelFamily } from "@/shared/prompts"
import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../../types"

export async function getToolUseFormattingSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const focusChainEnabled = context.focusChainSettings?.enabled

	if (variant.family === ModelFamily.GPT_5) {
		// For GPT-5 with function calling, omit explicit tool-call formatting from the prompt
		return ""
	}

	// Legacy formatting for models that still rely on XML wrappers
	const templateEngine = new TemplateEngine()
	return templateEngine.resolve(TOOL_USE_FORMATTING_TEMPLATE_TEXT, context, {
		FOCUS_CHATIN_FORMATTING: focusChainEnabled ? FOCUS_CHATIN_FORMATTING_TEMPLATE : "",
	})
}

const GPT5_FOCUS_CHAIN_ARGUMENT = `,
  "task_progress": "- [x] Set up project structure\\n- [ ] Pending follow-up"
`

const GPT5_TOOL_USE_FORMATTING_TEMPLATE_TEXT = `# Tool Call Formatting

- When you need to use a tool, set **Tool** to the tool's name and provide a JSON object in **Arguments**.
- The platform formats the tool call for you; emit only the structured arguments—no XML or conversational wrappers.
- Supply only keys that have meaningful values. Leave optional parameters out if you do not need them.

Example:

Tool: read_file
Arguments:
{
  "path": "src/main.js"{{FOCUS_CHAIN_ARGUMENT}}
}

If a tool requires no arguments, pass an empty object: 

Tool: list_files
Arguments:
{ }
`

const FOCUS_CHATIN_FORMATTING_TEMPLATE = `<task_progress>
Checklist here (optional)
</task_progress>
`

const TOOL_USE_FORMATTING_TEMPLATE_TEXT = `# Tool Use Formatting

Tool use is formatted using XML-style tags. The tool name is enclosed in opening and closing tags, and each parameter is similarly enclosed within its own set of tags. Here's the structure:

<tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
...
</tool_name>

For example:

<read_file>
<path>src/main.js</path>
{{FOCUS_CHATIN_FORMATTING}}</read_file>

Always adhere to this format for the tool use to ensure proper parsing and execution.`
