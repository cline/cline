import { ModelFamily } from "@/shared/prompts"
import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../../types"

const FOCUS_CHAIN_EXAMPLE_BASH = `<task_progress>
- [x] Set up project structure
- [x] Install dependencies
- [ ] Run command to start server
- [ ] Test application
</task_progress>
`

const FOCUS_CHAIN_EXAMPLE_NEW_FILE = `<task_progress>
- [x] Set up project structure
- [x] Install dependencies
- [ ] Create components
- [ ] Test application
</task_progress>
`

const FOCUS_CHAIN_EXAMPLE_EDIT = `<task_progress>
- [x] Set up project structure
- [x] Install dependencies
- [ ] Create components
- [ ] Test application
</task_progress>
`

const TOOL_USE_EXAMPLES_TEMPLATE_TEXT = `# Tool Use Examples

## Example 1: Requesting to execute a command

<execute_command>
<command>npm run dev</command>
<requires_approval>false</requires_approval>
{{FOCUS_CHAIN_EXAMPLE_BASH}}</execute_command>

## Example 2: Requesting to create a new file

<write_to_file>
<path>src/frontend-config.json</path>
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
{{FOCUS_CHAIN_EXAMPLE_NEW_FILE}}</write_to_file>

## Example 3: Creating a new task

<new_task>
<context>
1. Current Work:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Relevant Files and Code:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [File Name 2]
      - [Important Code Snippet]
   - [...]

4. Problem Solving:
   [Detailed description]

5. Pending Tasks and Next Steps:
   - [Task 1 details & next steps]
   - [Task 2 details & next steps]
   - [...]
</context>
</new_task>

## Example 4: Requesting to make targeted edits to a file

<replace_in_file>
<path>src/components/App.tsx</path>
<diff>
------- SEARCH
import React from 'react';
=======
import React, { useState } from 'react';
+++++++ REPLACE

------- SEARCH
function handleSubmit() {
  saveData();
  setLoading(false);
}

=======
+++++++ REPLACE

------- SEARCH
return (
  <div>
=======
function handleSubmit() {
  saveData();
  setLoading(false);
}

return (
  <div>
+++++++ REPLACE
</diff>
{{FOCUS_CHAIN_EXAMPLE_EDIT}}</replace_in_file>


## Example 5: Requesting to use an MCP tool

<use_mcp_tool>
<server_name>weather-server</server_name>
<tool_name>get_forecast</tool_name>
<arguments>
{
  "city": "San Francisco",
  "days": 5
}
</arguments>
</use_mcp_tool>

## Example 6: Another example of using an MCP tool (where the server name is a unique identifier such as a URL)

<use_mcp_tool>
<server_name>github.com/modelcontextprotocol/servers/tree/main/src/github</server_name>
<tool_name>create_issue</tool_name>
<arguments>
{
  "owner": "octocat2",
  "repo": "hello-world",
  "title": "Found a bug",
  "body": "I'm having a problem with this.",
  "labels": ["bug", "help wanted"],
  "assignees": ["octocat"]
}
</arguments>
</use_mcp_tool>`

const GPT5_TOOL_USE_EXAMPLES_TEMPLATE_TEXT = `# Tool Use Examples

## Example 1: Requesting to execute a command

Tool: execute_command
Arguments:
{
  "command": "npm run dev",
  "requires_approval": false
}

## Example 2: Requesting to create a new file

Tool: write_to_file
Arguments:
{
  "path": "src/frontend-config.json",
  "content": "{\\n  \"apiEndpoint\": \"https://api.example.com\",\\n  \"theme\": {\\n    \"primaryColor\": \"#007bff\",\\n    \"secondaryColor\": \"#6c757d\",\\n    \"fontFamily\": \"Arial, sans-serif\"\\n  },\\n  \"features\": {\\n    \"darkMode\": true,\\n    \"notifications\": true,\\n    \"analytics\": false\\n  },\\n  \"version\": \"1.0.0\"\\n}"
}

## Example 3: Creating a new task

Tool: new_task
Arguments:
{
  "context": "1. Current Work:\\n   [Detailed description]\\n\\n2. Key Technical Concepts:\\n   - [Concept 1]\\n   - [Concept 2]\\n   - [...]\\n\\n3. Relevant Files and Code:\\n   - [File Name 1]\\n      - [Summary of why this file is important]\\n      - [Summary of the changes made to this file, if any]\\n      - [Important Code Snippet]\\n   - [File Name 2]\\n      - [Important Code Snippet]\\n   - [...]\\n\\n4. Problem Solving:\\n   [Detailed description]\\n\\n5. Pending Tasks and Next Steps:\\n   - [Task 1 details & next steps]\\n   - [Task 2 details & next steps]\\n   - [...]"
}

## Example 4: Requesting to make targeted edits to a file

Tool: replace_in_file
Arguments:
{
  "path": "src/components/App.tsx",
  "diff": "------- SEARCH\\nimport React from 'react';\\n=======\\nimport React, { useState } from 'react';\\n+++++++ REPLACE\\n\\n------- SEARCH\\nfunction handleSubmit() {\\n  saveData();\\n  setLoading(false);\\n}\\n\\n=======\\n+++++++ REPLACE\\n\\n------- SEARCH\\nreturn (\\n  <div>\\n=======\\nfunction handleSubmit() {\\n  saveData();\\n  setLoading(false);\\n}\\n\\nreturn (\\n  <div>\\n+++++++ REPLACE"
}

## Example 5: Requesting to use an MCP tool

Tool: use_mcp_tool
Arguments:
{
  "server_name": "weather-server",
  "tool_name": "get_forecast",
  "arguments": {
    "city": "San Francisco",
    "days": 5
  }
}

## Example 6: Another example of using an MCP tool (where the server name is a unique identifier such as a URL)

Tool: use_mcp_tool
Arguments:
{
  "server_name": "github.com/modelcontextprotocol/servers/tree/main/src/github",
  "tool_name": "create_issue",
  "arguments": {
    "owner": "octocat",
    "repo": "hello-world",
    "title": "Found a bug",
    "body": "I'm having a problem with this.",
    "labels": ["bug", "help wanted"],
    "assignees": ["octocat"]
  }
}`

export async function getToolUseExamplesSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const focusChainEnabled = context.focusChainSettings?.enabled

	// For GPT-5 with function calling, omit tool-use examples from the prompt
	if (variant.family === ModelFamily.GPT_5) {
		return ""
	}

	return new TemplateEngine().resolve(TOOL_USE_EXAMPLES_TEMPLATE_TEXT, context, {
		FOCUS_CHAIN_EXAMPLE_BASH: focusChainEnabled ? FOCUS_CHAIN_EXAMPLE_BASH : "",
		FOCUS_CHAIN_EXAMPLE_NEW_FILE: focusChainEnabled ? FOCUS_CHAIN_EXAMPLE_NEW_FILE : "",
		FOCUS_CHAIN_EXAMPLE_EDIT: focusChainEnabled ? FOCUS_CHAIN_EXAMPLE_EDIT : "",
	})
}
