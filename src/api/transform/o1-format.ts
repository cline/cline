import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

const o1SystemPrompt = (systemPrompt: string) => `
# System Prompt

${systemPrompt}

# Instructions for Formulating Your Response

You must respond to the user's request by using at least one tool call. When formulating your response, follow these guidelines:

1. Begin your response with normal text, explaining your thoughts, analysis, or plan of action.
2. If you need to use any tools, place ALL tool calls at the END of your message, after your normal text explanation.
3. You can use multiple tool calls if needed, but they should all be grouped together at the end of your message.
4. After placing the tool calls, do not add any additional normal text. The tool calls should be the final content in your message.

Here's the general structure your responses should follow:

\`\`\`
[Your normal text response explaining your thoughts and actions]

[Tool Call 1]
[Tool Call 2 if needed]
[Tool Call 3 if needed]
...
\`\`\`

Remember:
- Choose the most appropriate tool(s) based on the task and the tool descriptions provided.
- Formulate your tool calls using the XML format specified for each tool.
- Provide clear explanations in your normal text about what actions you're taking and why you're using particular tools.
- Act as if the tool calls will be executed immediately after your message, and your next response will have access to their results.

# Tool Descriptions and XML Formats

1. execute_command:
<execute_command>
<command>Your command here</command>
</execute_command>
Description: Execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Commands will be executed in the current working directory.

2. list_files:
<list_files>
<path>Directory path here</path>
<recursive>true or false (optional)</recursive>
</list_files>
Description: List files and directories within the specified directory. If recursive is true, it will list all files and directories recursively. If recursive is false or not provided, it will only list the top-level contents.

3. list_code_definition_names:
<list_code_definition_names>
<path>Directory path here</path>
</list_code_definition_names>
Description: Lists definition names (classes, functions, methods, etc.) used in source code files at the top level of the specified directory. This tool provides insights into the codebase structure and important constructs, encapsulating high-level concepts and relationships that are crucial for understanding the overall architecture.

4. search_files:
<search_files>
<path>Directory path here</path>
<regex>Your regex pattern here</regex>
<filePattern>Optional file pattern here</filePattern>
</search_files>
Description: Perform a regex search across files in a specified directory, providing context-rich results. This tool searches for patterns or specific content across multiple files, displaying each match with encapsulating context.

5. read_file:
<read_file>
<path>File path here</path>
</read_file>
Description: Read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file, for example to analyze code, review text files, or extract information from configuration files. Automatically extracts raw text from PDF and DOCX files. May not be suitable for other types of binary files, as it returns the raw content as a string.

6. write_to_file:
<write_to_file>
<path>File path here</path>
<content>
Your file content here
</content>
</write_to_file>
Description: Write content to a file at the specified path. If the file exists, it will be overwritten with the provided content. If the file doesn't exist, it will be created. Always provide the full intended content of the file, without any truncation. This tool will automatically create any directories needed to write the file.

7. ask_followup_question:
<ask_followup_question>
<question>Your question here</question>
</ask_followup_question>
Description: Ask the user a question to gather additional information needed to complete the task. This tool should be used when you encounter ambiguities, need clarification, or require more details to proceed effectively. It allows for interactive problem-solving by enabling direct communication with the user. Use this tool judiciously to maintain a balance between gathering necessary information and avoiding excessive back-and-forth.

8. attempt_completion:
<attempt_completion>
<command>Optional command to demonstrate result</command>
<result>
Your final result description here
</result>
</attempt_completion>
Description: Once you've completed the task, use this tool to present the result to the user. They may respond with feedback if they are not satisfied with the result, which you can use to make improvements and try again.

# Examples

Here are some examples of how to structure your responses with tool calls:

Example 1: Using a single tool

Let's run the test suite for our project. This will help us ensure that all our components are functioning correctly.

<execute_command>
<command>npm test</command>
</execute_command>

Example 2: Using multiple tools

Let's create two new configuration files for the web application: one for the frontend and one for the backend.

<write_to_file>
<path>./frontend-config.json</path>
<content>
{
  "apiEndpoint": "https://api.example.com",
  "theme": {
    "primaryColor": "#007bff",
    "secondaryColor": "#6c757d",
    "fontFamily": "Arial, sans-serif"
  },
  "features": {
    "darkMode": true,
    "notifications": true,
    "analytics": false
  },
  "version": "1.0.0"
}
</content>
</write_to_file>

<write_to_file>
<path>./backend-config.yaml</path>
<content>
database:
  host: localhost
  port: 5432
  name: myapp_db
  user: admin

server:
  port: 3000
  environment: development
  logLevel: debug

security:
  jwtSecret: your-secret-key-here
  passwordSaltRounds: 10

caching:
  enabled: true
  provider: redis
  ttl: 3600

externalServices:
  emailProvider: sendgrid
  storageProvider: aws-s3
</content>
</write_to_file>

Example 3: Asking a follow-up question

I've analyzed the project structure, but I need more information to proceed. Let me ask the user for clarification.

<ask_followup_question>
<question>Which specific feature would you like me to implement in the example.py file?</question>
</ask_followup_question>
`

export function convertToO1Messages(
	openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[],
	systemPrompt: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
	const toolsReplaced = openAiMessages.reduce((acc, message) => {
		if (message.role === "tool") {
			// Convert tool messages to user messages
			acc.push({
				role: "user",
				content: message.content || "",
			})
		} else if (message.role === "assistant" && message.tool_calls) {
			// Convert tool calls to content and remove tool_calls
			let content = message.content || ""
			message.tool_calls.forEach((toolCall) => {
				if (toolCall.type === "function") {
					content += `\nTool Call: ${toolCall.function.name}\nArguments: ${toolCall.function.arguments}`
				}
			})
			acc.push({
				role: "assistant",
				content: content,
				tool_calls: undefined,
			})
		} else {
			// Keep other messages as they are
			acc.push(message)
		}
		return acc
	}, [] as OpenAI.Chat.ChatCompletionMessageParam[])

	// Find the index of the last assistant message
	// const lastAssistantIndex = findLastIndex(toolsReplaced, (message) => message.role === "assistant")

	// Create a new array to hold the modified messages
	const messagesWithSystemPrompt = [
		{
			role: "user",
			content: o1SystemPrompt(systemPrompt),
		} as OpenAI.Chat.ChatCompletionUserMessageParam,
		...toolsReplaced,
	]

	// If there's an assistant message, insert the system prompt after it
	// if (lastAssistantIndex !== -1) {
	// 	const insertIndex = lastAssistantIndex + 1
	// 	if (insertIndex < messagesWithSystemPrompt.length && messagesWithSystemPrompt[insertIndex].role === "user") {
	// 		messagesWithSystemPrompt.splice(insertIndex, 0, {
	// 			role: "user",
	// 			content: o1SystemPrompt(systemPrompt),
	// 		})
	// 	}
	// } else {
	// 	// If there were no assistant messages, prepend the system prompt
	// 	messagesWithSystemPrompt.unshift({
	// 		role: "user",
	// 		content: o1SystemPrompt(systemPrompt),
	// 	})
	// }

	return messagesWithSystemPrompt
}

interface ToolCall {
	tool: string
	tool_input: Record<string, string>
}

const toolNames = [
	"execute_command",
	"list_files",
	"list_code_definition_names",
	"search_files",
	"read_file",
	"write_to_file",
	"ask_followup_question",
	"attempt_completion",
]

function parseAIResponse(response: string): { normalText: string; toolCalls: ToolCall[] } {
	// Create a regex pattern to match any tool call opening tag
	const toolCallPattern = new RegExp(`<(${toolNames.join("|")})`, "i")
	const match = response.match(toolCallPattern)

	if (!match) {
		// No tool calls found
		return { normalText: response.trim(), toolCalls: [] }
	}

	const toolCallStart = match.index!
	const normalText = response.slice(0, toolCallStart).trim()
	const toolCallsText = response.slice(toolCallStart)

	const toolCalls = parseToolCalls(toolCallsText)

	return { normalText, toolCalls }
}

function parseToolCalls(toolCallsText: string): ToolCall[] {
	const toolCalls: ToolCall[] = []

	let remainingText = toolCallsText

	while (remainingText.length > 0) {
		const toolMatch = toolNames.find((tool) => new RegExp(`<${tool}`, "i").test(remainingText))

		if (!toolMatch) {
			break // No more tool calls found
		}

		const startTag = `<${toolMatch}`
		const endTag = `</${toolMatch}>`
		const startIndex = remainingText.indexOf(startTag)
		const endIndex = remainingText.indexOf(endTag, startIndex)

		if (endIndex === -1) {
			break // Malformed XML, no closing tag found
		}

		const toolCallContent = remainingText.slice(startIndex, endIndex + endTag.length)
		remainingText = remainingText.slice(endIndex + endTag.length).trim()

		const toolCall = parseToolCall(toolMatch, toolCallContent)
		if (toolCall) {
			toolCalls.push(toolCall)
		}
	}

	return toolCalls
}

function parseToolCall(toolName: string, content: string): ToolCall | null {
	const tool_input: Record<string, string> = {}

	// Remove the outer tool tags
	const innerContent = content.replace(new RegExp(`^<${toolName}>|</${toolName}>$`, "g"), "").trim()

	// Parse nested XML elements
	const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/gs
	let match

	while ((match = paramRegex.exec(innerContent)) !== null) {
		const [, paramName, paramValue] = match
		// Preserve newlines and trim only leading/trailing whitespace
		tool_input[paramName] = paramValue.replace(/^\s+|\s+$/g, "")
	}

	// Validate required parameters
	if (!validateToolInput(toolName, tool_input)) {
		console.error(`Invalid tool call for ${toolName}:`, content)
		return null
	}

	return { tool: toolName, tool_input }
}

function validateToolInput(toolName: string, tool_input: Record<string, string>): boolean {
	switch (toolName) {
		case "execute_command":
			return "command" in tool_input
		case "read_file":
		case "list_code_definition_names":
		case "list_files":
			return "path" in tool_input
		case "search_files":
			return "path" in tool_input && "regex" in tool_input
		case "write_to_file":
			return "path" in tool_input && "content" in tool_input
		case "ask_followup_question":
			return "question" in tool_input
		case "attempt_completion":
			return "result" in tool_input
		default:
			return false
	}
}

// Example usage:
// const aiResponse = `Here's my analysis of the situation...

// <execute_command>
//   <command>ls -la</command>
// </execute_command>

// <write_to_file>
//   <path>./example.txt</path>
//   <content>Hello, World!</content>
// </write_to_file>`;
//
// const { normalText, toolCalls } = parseAIResponse(aiResponse);
// console.log(normalText);
// console.log(toolCalls);

// Convert OpenAI response to Anthropic format
export function convertO1ResponseToAnthropicMessage(
	completion: OpenAI.Chat.Completions.ChatCompletion,
): Anthropic.Messages.Message {
	const openAiMessage = completion.choices[0].message
	const { normalText, toolCalls } = parseAIResponse(openAiMessage.content || "")

	const anthropicMessage: Anthropic.Messages.Message = {
		id: completion.id,
		type: "message",
		role: openAiMessage.role, // always "assistant"
		content: [
			{
				type: "text",
				text: normalText,
			},
		],
		model: completion.model,
		stop_reason: (() => {
			switch (completion.choices[0].finish_reason) {
				case "stop":
					return "end_turn"
				case "length":
					return "max_tokens"
				case "tool_calls":
					return "tool_use"
				case "content_filter": // Anthropic doesn't have an exact equivalent
				default:
					return null
			}
		})(),
		stop_sequence: null, // which custom stop_sequence was generated, if any (not applicable if you don't use stop_sequence)
		usage: {
			input_tokens: completion.usage?.prompt_tokens || 0,
			output_tokens: completion.usage?.completion_tokens || 0,
		},
	}

	if (toolCalls.length > 0) {
		anthropicMessage.content.push(
			...toolCalls.map((toolCall: ToolCall, index: number): Anthropic.ToolUseBlock => {
				return {
					type: "tool_use",
					id: `call_${index}_${Date.now()}`, // Generate a unique ID for each tool call
					name: toolCall.tool,
					input: toolCall.tool_input,
				}
			}),
		)
	}

	return anthropicMessage
}

// Example usage:
// const openAICompletion = {
//     id: "cmpl-123",
//     choices: [{
//         message: {
//             role: "assistant",
//             content: "Here's my analysis...\n\n<execute_command>\n  <command>ls -la</command>\n</execute_command>"
//         },
//         finish_reason: "stop"
//     }],
//     model: "gpt-3.5-turbo",
//     usage: { prompt_tokens: 50, completion_tokens: 100 }
// };
// const anthropicMessage = convertO1ResponseToAnthropicMessage(openAICompletion);
// console.log(anthropicMessage);
