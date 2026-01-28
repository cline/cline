import { SubAgentToolDefinition } from "./tools"

/**
 * Builds the tools placeholder string for the system prompt.
 * Formats all tool definitions into a readable instruction format.
 */
export function buildToolsPlaceholder(tools: SubAgentToolDefinition[]): string {
	const toolsPrompts: string[] = []

	for (const tool of tools) {
		const prompt = `\`<${tool.title}><${tool.tag}>${tool.placeholder}</${tool.tag}></${tool.title}>\`: ${tool.instruction}.`

		if (tool.examples && tool.examples.length > 0) {
			toolsPrompts.push(`${prompt}\n\t- ${tool.examples.join("\n\t- ")}`)
		} else {
			toolsPrompts.push(prompt)
		}
	}

	return toolsPrompts.join("\n")
}

export function extractTagContent(response: string, tag: string): string[] {
	const tagLength = tag.length
	return response.match(new RegExp(`<${tag}>(.*?)</${tag}>`, "g"))?.map((m) => m.slice(tagLength + 2, -(tagLength + 3))) || []
}
