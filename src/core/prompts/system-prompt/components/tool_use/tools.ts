import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext, ToolName } from "../../types"

// Default tool order when no tools are specified
const DEFAULT_TOOL_ORDER: ToolName[] = [
	"execute_command",
	"read_file",
	"write_to_file",
	"replace_in_file",
	"search_files",
	"list_files",
	"list_code_definition_names",
	"browser_action",
	"web_fetch",
	"use_mcp_tool",
	"access_mcp_resource",
	"ask_followup_question",
	"attempt_completion",
	"new_task",
	"plan_mode_respond",
	"load_mcp_documentation",
]

export async function getToolUseToolsSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const focusChainEnabled = context.focusChainSettings?.enabled
	const browserEnabled = context.supportsBrowserUse ?? false
	const isNextGen = variant.family === "next-gen"

	// Determine which tools to include and in what order
	const toolsToInclude = variant.tools || DEFAULT_TOOL_ORDER

	// Build the tools section
	const toolSections: string[] = ["# Tools"]

	for (const toolName of toolsToInclude) {
		// Check if tool is enabled (default to true if not specified)
		const toolOverride = variant.toolOverrides?.[toolName]
		const isEnabled = toolOverride?.enabled !== false

		if (!isEnabled) {
			continue
		}

		// Apply conditional logic for certain tools
		if (toolName === "browser_action" && !browserEnabled) {
			continue
		}

		if (toolName === "web_fetch" && !isNextGen) {
			continue
		}

		// Get the tool template (use override if provided, otherwise default)
		const toolTemplate = toolOverride?.template || TOOL_TEMPLATES[toolName]

		if (toolTemplate) {
			toolSections.push(toolTemplate)
		}
	}

	const template = toolSections.join("\n\n")

	return new TemplateEngine().resolve(template, {
		TASK_PROGRESS: focusChainEnabled ? TASK_PROGRESS : "",
		FOCUS_CHAIN_ATTEMPT: focusChainEnabled ? FOCUS_CHAIN_ATTEMPT : "",
		FOCUS_CHAIN_USAGE: focusChainEnabled ? FOCUS_CHAIN_USAGE : "",
		BROWSER_VIEWPORT_WIDTH: context.browserSettings?.viewport?.width || 0,
		BROWSER_VIEWPORT_HEIGHT: context.browserSettings?.viewport?.height || 0,
	})
}

// Focus chain related constants
const TASK_PROGRESS = `- task_progress: (optional) A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)`
const FOCUS_CHAIN_ATTEMPT = `If you were using task_progress to update the task progress, you must include the completed list in the result as well.`
const FOCUS_CHAIN_USAGE = `<task_progress>
Checklist here (optional)
</task_progress>
`

const EXECUTE_COMMAND = `## execute_command
Description: Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. For command chaining, use the appropriate chaining syntax for the user's shell. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Commands will be executed in the current working directory: {{CWD}}
Parameters:
- command: (required) The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.
- requires_approval: (required) A boolean indicating whether this command requires explicit user approval before execution in case the user has auto-approve mode enabled. Set to 'true' for potentially impactful operations like installing/uninstalling packages, deleting/overwriting files, system configuration changes, network operations, or any commands that could have unintended side effects. Set to 'false' for safe operations like reading files/directories, running development servers, building projects, and other non-destructive operations.
{{TASK_PROGRESS}}Usage:
<execute_command>
<command>Your command here</command>
<requires_approval>true or false</requires_approval>
{{FOCUS_CHAIN_USAGE}}</execute_command>`

const READ_FILE = `## read_file
Description: Request to read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file you do not know the contents of, for example to analyze code, review text files, or extract information from configuration files. Automatically extracts raw text from PDF and DOCX files. May not be suitable for other types of binary files, as it returns the raw content as a string.
Parameters:
- path: (required) The path of the file to read (relative to the current working directory {{CWD}})
{{TASK_PROGRESS}}Usage:
<read_file>
<path>File path here</path>
{{FOCUS_CHAIN_USAGE}}</read_file>`

const WRITE_TO_FILE = `## write_to_file
Description: Request to write content to a file at the specified path. If the file exists, it will be overwritten with the provided content. If the file doesn't exist, it will be created. This tool will automatically create any directories needed to write the file.
Parameters:
- path: (required) The path of the file to write to (relative to the current working directory {{CWD}})
- content: (required) The content to write to the file. ALWAYS provide the COMPLETE intended content of the file, without any truncation or omissions. You MUST include ALL parts of the file, even if they haven't been modified.
{{TASK_PROGRESS}}Usage:
Usage:
<write_to_file>
<path>File path here</path>
<content>
Your file content here
</content>
{{FOCUS_CHAIN_USAGE}}</write_to_file>`

const REPLACE_IN_FILE = `## replace_in_file
Description: Request to replace sections of content in an existing file using SEARCH/REPLACE blocks that define exact changes to specific parts of the file. This tool should be used when you need to make targeted changes to specific parts of a file.
Parameters:
- path: (required) The path of the file to modify (relative to the current working directory {{CWD}})
- diff: (required) One or more SEARCH/REPLACE blocks following this exact format:
  \`\`\`
  ------- SEARCH
  [exact content to find]
  =======
  [new content to replace with]
  +++++++ REPLACE
  \`\`\`
  Critical rules:
  1. SEARCH content must match the associated file section to find EXACTLY:
     * Match character-for-character including whitespace, indentation, line endings
     * Include all comments, docstrings, etc.
  2. SEARCH/REPLACE blocks will ONLY replace the first match occurrence.
     * Including multiple unique SEARCH/REPLACE blocks if you need to make multiple changes.
     * Include *just* enough lines in each SEARCH section to uniquely match each set of lines that need to change.
     * When using multiple SEARCH/REPLACE blocks, list them in the order they appear in the file.
  3. Keep SEARCH/REPLACE blocks concise:
     * Break large SEARCH/REPLACE blocks into a series of smaller blocks that each change a small portion of the file.
     * Include just the changing lines, and a few surrounding lines if needed for uniqueness.
     * Do not include long runs of unchanging lines in SEARCH/REPLACE blocks.
     * Each line must be complete. Never truncate lines mid-way through as this can cause matching failures.
  4. Special operations:
     * To move code: Use two SEARCH/REPLACE blocks (one to delete from original + one to insert at new location)
     * To delete code: Use empty REPLACE section
{{TASK_PROGRESS}}Usage:
<replace_in_file>
<path>File path here</path>
<diff>
Search and replace blocks here
</diff>
{{FOCUS_CHAIN_USAGE}}</replace_in_file>`

const SEARCH_FILE = `## search_files
Description: Request to perform a regex search across files in a specified directory, providing context-rich results. This tool searches for patterns or specific content across multiple files, displaying each match with encapsulating context.
Parameters:
- path: (required) The path of the directory to search in (relative to the current working directory {{CWD}}). This directory will be recursively searched.
- regex: (required) The regular expression pattern to search for. Uses Rust regex syntax.
- file_pattern: (optional) Glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).
Usage:
<search_files>
<path>Directory path here</path>
<regex>Your regex pattern here</regex>
<file_pattern>file pattern here (optional)</file_pattern>
</search_files>`

const LIST_FILES = `## list_files
Description: Request to list files and directories within the specified directory. If recursive is true, it will list all files and directories recursively. If recursive is false or not provided, it will only list the top-level contents. Do not use this tool to confirm the existence of files you may have created, as the user will let you know if the files were created successfully or not.
Parameters:
- path: (required) The path of the directory to list contents for (relative to the current working directory {{CWD}})
- recursive: (optional) Whether to list files recursively. Use true for recursive listing, false or omit for top-level only.
Usage:
<list_files>
<path>Directory path here</path>
<recursive>true or false (optional)</recursive>
</list_files>`

const LIST_CODE_DEFINITION_NAMES = `## list_code_definition_names
Description: Request to list definition names (classes, functions, methods, etc.) used in source code files at the top level of the specified directory. This tool provides insights into the codebase structure and important constructs, encapsulating high-level concepts and relationships that are crucial for understanding the overall architecture.
Parameters:
- path: (required) The path of the directory (relative to the current working directory {{CWD}}) to list top level source code definitions for.
Usage:
<list_code_definition_names>
<path>Directory path here</path>
</list_code_definition_names>`

const USE_MCP_TOOL = `## use_mcp_tool
Description: Request to use a tool provided by a connected MCP server. Each MCP server can provide multiple tools with different capabilities. Tools have defined input schemas that specify required and optional parameters.
Parameters:
- server_name: (required) The name of the MCP server providing the tool
- tool_name: (required) The name of the tool to execute
- arguments: (required) A JSON object containing the tool's input parameters, following the tool's input schema
{{TASK_PROGRESS}}Usage:
<use_mcp_tool>
<server_name>server name here</server_name>
<tool_name>tool name here</tool_name>
<arguments>
{
  "param1": "value1",
  "param2": "value2"
}
</arguments>
{{FOCUS_CHAIN_USAGE}}</use_mcp_tool>`

const ACCESS_MCP_RESOURCES = `## access_mcp_resource
Description: Request to access a resource provided by a connected MCP server. Resources represent data sources that can be used as context, such as files, API responses, or system information.
Parameters:
- server_name: (required) The name of the MCP server providing the resource
- uri: (required) The URI identifying the specific resource to access
{{TASK_PROGRESS}}Usage:
<access_mcp_resource>
<server_name>server name here</server_name>
<uri>resource URI here</uri>
{{FOCUS_CHAIN_USAGE}}</access_mcp_resource>`

const ASK_FOLLOWUP_QUESTION = `## ask_followup_question
Description: Ask the user a question to gather additional information needed to complete the task. This tool should be used when you encounter ambiguities, need clarification, or require more details to proceed effectively. It allows for interactive problem-solving by enabling direct communication with the user. Use this tool judiciously to maintain a balance between gathering necessary information and avoiding excessive back-and-forth.
Parameters:
- question: (required) The question to ask the user. This should be a clear, specific question that addresses the information you need.
- options: (optional) An array of 2-5 options for the user to choose from. Each option should be a string describing a possible answer. You may not always need to provide options, but it may be helpful in many cases where it can save the user from having to type out a response manually. IMPORTANT: NEVER include an option to toggle to Act mode, as this would be something you need to direct the user to do manually themselves if needed.
Usage:
<ask_followup_question>
<question>Your question here</question>
<options>
Array of options here (optional), e.g. ["Option 1", "Option 2", "Option 3"]
</options>
</ask_followup_question>`

const ATTEMPT_COMPLETION = `## attempt_completion
Description: After each tool use, the user will respond with the result of that tool use, i.e. if it succeeded or failed, along with any reasons for failure. Once you've received the results of tool uses and can confirm that the task is complete, use this tool to present the result of your work to the user. Optionally you may provide a CLI command to showcase the result of your work. The user may respond with feedback if they are not satisfied with the result, which you can use to make improvements and try again.
IMPORTANT NOTE: This tool CANNOT be used until you've confirmed from the user that any previous tool uses were successful. Failure to do so will result in code corruption and system failure. Before using this tool, you must ask yourself in <thinking></thinking> tags if you've confirmed from the user that any previous tool uses were successful. If not, then DO NOT use this tool.
{{FOCUS_CHAIN_ATTEMPT}}Parameters:
- result: (required) The result of the task. Formulate this result in a way that is final and does not require further input from the user. Don't end your result with questions or offers for further assistance.
- command: (optional) A CLI command to execute to show a live demo of the result to the user. For example, use \`open index.html\` to display a created html website, or \`open localhost:3000\` to display a locally running development server. But DO NOT use commands like \`echo\` or \`cat\` that merely print text. This command should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.
{{TASK_PROGRESS}}Usage:
<attempt_completion>
{{FOCUS_CHAIN_USAGE}}<result>
Your final result description here
</result>
<command>Command to demonstrate result (optional)</command>
</attempt_completion>`

const NEW_TASK = `## new_task
Description: Request to create a new task with preloaded context covering the conversation with the user up to this point and key information for continuing with the new task. With this tool, you will create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions, with a focus on the most relevant information required for the new task.
Among other important areas of focus, this summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the new task. The user will be presented with a preview of your generated context and can choose to create a new task or keep chatting in the current conversation. The user may choose to start a new task at any point.
Parameters:
- Context: (required) The context to preload the new task with. If applicable based on the current task, this should include:
  1. Current Work: Describe in detail what was being worked on prior to this request to create a new task. Pay special attention to the more recent messages / conversation.
  2. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for the new task.
  3. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  4. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  5. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks. It's important to be detailed here.
Usage:
<new_task>
<context>context to preload new task with</context>
</new_task>`

const PLAN_MODE_RESPOND = `## plan_mode_respond
Description: Respond to the user's inquiry in an effort to plan a solution to the user's task. This tool should ONLY be used when you have already explored the relevant files and are ready to present a concrete plan. DO NOT use this tool to announce what files you're going to read - just read them first. This tool is only available in PLAN MODE. The environment_details will specify the current mode; if it is not PLAN_MODE then you should not use this tool.
However, if while writing your response you realize you actually need to do more exploration before providing a complete plan, you can add the optional needs_more_exploration parameter to indicate this. This allows you to acknowledge that you should have done more exploration first, and signals that your next message will use exploration tools instead.
Parameters:
- response: (required) The response to provide to the user. Do not try to use tools in this parameter, this is simply a chat response. (You MUST use the response parameter, do not simply place the response text directly within <plan_mode_respond> tags.)
- needs_more_exploration: (optional) Set to true if while formulating your response that you found you need to do more exploration with tools, for example reading files. (Remember, you can explore the project with tools like read_file in PLAN MODE without the user having to toggle to ACT MODE.) Defaults to false if not specified.
{{TASK_PROGRESS}}Usage:
<plan_mode_respond>
<response>Your response here</response>
<needs_more_exploration>true or false (optional, but you MUST set to true if in <response> you need to read files or use other exploration tools)</needs_more_exploration>
{{FOCUS_CHAIN_USAGE}}</plan_mode_respond>`

const LOAD_MCP_DOCS = `## load_mcp_documentation
Description: Load documentation about creating MCP servers. This tool should be used when the user requests to create or install an MCP server (the user may ask you something along the lines of "add a tool" that does some function, in other words to create an MCP server that provides tools and resources that may connect to external APIs for example. You have the ability to create an MCP server and add it to a configuration file that will then expose the tools and resources for you to use with \`use_mcp_tool\` and \`access_mcp_resource\`). The documentation provides detailed information about the MCP server creation process, including setup instructions, best practices, and examples.
Parameters: None
Usage:
<load_mcp_documentation>
</load_mcp_documentation>`

const BROWSER_ACTION = `## browser_action
Description: Request to interact with a Puppeteer-controlled browser. Every action, except \`close\`, will be responded to with a screenshot of the browser's current state, along with any new console logs. You may only perform one browser action per message, and wait for the user's response including a screenshot and logs to determine the next action.
- The sequence of actions **must always start with** launching the browser at a URL, and **must always end with** closing the browser. If you need to visit a new URL that is not possible to navigate to from the current webpage, you must first close the browser, then launch again at the new URL.
- While the browser is active, only the \`browser_action\` tool can be used. No other tools should be called during this time. You may proceed to use other tools only after closing the browser. For example if you run into an error and need to fix a file, you must close the browser, then use other tools to make the necessary changes, then re-launch the browser to verify the result.
- The browser window has a resolution of **{{BROWSER_VIEWPORT_WIDTH}}x{{BROWSER_VIEWPORT_HEIGHT}}** pixels. When performing any click actions, ensure the coordinates are within this resolution range.
- Before clicking on any elements such as icons, links, or buttons, you must consult the provided screenshot of the page to determine the coordinates of the element. The click should be targeted at the **center of the element**, not on its edges.
Parameters:
- action: (required) The action to perform. The available actions are:
    * launch: Launch a new Puppeteer-controlled browser instance at the specified URL. This **must always be the first action**.
        - Use with the \`url\` parameter to provide the URL.
        - Ensure the URL is valid and includes the appropriate protocol (e.g. http://localhost:3000/page, file:///path/to/file.html, etc.)
    * click: Click at a specific x,y coordinate.
        - Use with the \`coordinate\` parameter to specify the location.
        - Always click in the center of an element (icon, button, link, etc.) based on coordinates derived from a screenshot.
    * type: Type a string of text on the keyboard. You might use this after clicking on a text field to input text.
        - Use with the \`text\` parameter to provide the string to type.
    * scroll_down: Scroll down the page by one page height.
    * scroll_up: Scroll up the page by one page height.
    * close: Close the Puppeteer-controlled browser instance. This **must always be the final browser action**.
        - Example: \`<action>close</action>\`
- url: (optional) Use this for providing the URL for the \`launch\` action.
    * Example: <url>https://example.com</url>
- coordinate: (optional) The X and Y coordinates for the \`click\` action. Coordinates should be within the **{{BROWSER_VIEWPORT_WIDTH}}x{{BROWSER_VIEWPORT_HEIGHT}}** resolution.
    * Example: <coordinate>450,300</coordinate>
- text: (optional) Use this for providing the text for the \`type\` action.
    * Example: <text>Hello, world!</text>
Usage:
<browser_action>
<action>Action to perform (e.g., launch, click, type, scroll_down, scroll_up, close)</action>
<url>URL to launch the browser at (optional)</url>
<coordinate>x,y coordinates (optional)</coordinate>
<text>Text to type (optional)</text>
{{FOCUS_CHAIN_USAGE}}</browser_action>`

const WEB_FETCH = `## web_fetch
Description: Fetches content from a specified URL and processes into markdown
- Takes a URL as input
- Fetches the URL content, converts HTML to markdown
- Use this tool when you need to retrieve and analyze web content
- IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
- The URL must be a fully-formed valid URL
- HTTP URLs will be automatically upgraded to HTTPS
- This tool is read-only and does not modify any files
Parameters:
- url: (required) The URL to fetch content from
Usage:
<web_fetch>
<url>https://example.com/docs</url>
</web_fetch>`

// Map of tool names to their default templates
const TOOL_TEMPLATES: Record<ToolName, string> = {
	execute_command: EXECUTE_COMMAND,
	read_file: READ_FILE,
	write_to_file: WRITE_TO_FILE,
	replace_in_file: REPLACE_IN_FILE,
	search_files: SEARCH_FILE,
	list_files: LIST_FILES,
	list_code_definition_names: LIST_CODE_DEFINITION_NAMES,
	browser_action: BROWSER_ACTION,
	web_fetch: WEB_FETCH,
	use_mcp_tool: USE_MCP_TOOL,
	access_mcp_resource: ACCESS_MCP_RESOURCES,
	ask_followup_question: ASK_FOLLOWUP_QUESTION,
	attempt_completion: ATTEMPT_COMPLETION,
	new_task: NEW_TASK,
	plan_mode_respond: PLAN_MODE_RESPOND,
	load_mcp_documentation: LOAD_MCP_DOCS,
}
