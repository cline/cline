# Cline Tools Reference Guide

## What Can Cline Do?

Cline is your AI assistant that can:

-   Edit and create files in your project
-   Run terminal commands
-   Search and analyze your code
-   Help debug and fix issues
-   Automate repetitive tasks
-   Integrate with external tools

## First Steps

1. **Start a Task**

    - Type your request in the chat
    - Example: "Create a new React component called Header"

2. **Provide Context**

    - Use @ mentions to add files, folders, or URLs
    - Example: "@file:src/components/App.tsx"

3. **Review Changes**
    - Cline will show diffs before making changes
    - You can edit or reject changes

## Key Features

1. **File Editing**

    - Create new files
    - Modify existing code
    - Search and replace across files

2. **Terminal Commands**

    - Run npm commands
    - Start development servers
    - Install dependencies

3. **Code Analysis**

    - Find and fix errors
    - Refactor code
    - Add documentation

4. **Browser Integration**
    - Test web pages
    - Capture screenshots
    - Inspect console logs

## Available Tools

For the most up-to-date implementation details, you can view the full source code in the [Cline repository](https://github.com/cline/cline/blob/main/src/core/Cline.ts).

Cline has access to the following tools for various tasks:

1. **File Operations**

    - `write_to_file`: Create or overwrite files
    - `read_file`: Read file contents
    - `replace_in_file`: Make targeted edits to files
    - `search_files`: Search files using regex
    - `list_files`: List directory contents

2. **Terminal Operations**

    - `execute_command`: Run CLI commands
    - `list_code_definition_names`: List code definitions

3. **MCP Tools**

    - `use_mcp_tool`: Use tools from MCP servers
    - `access_mcp_resource`: Access MCP server resources
    - Users can create custom MCP tools that Cline can then access
    - Example: Create a weather API tool that Cline can use to fetch forecasts

4. **Interaction Tools**
    - `ask_followup_question`: Ask user for clarification
    - `attempt_completion`: Present final results

Each tool has specific parameters and usage patterns. Here are some examples:

-   Create a new file (write_to_file):

    ```xml
    <write_to_file>
    <path>src/components/Header.tsx</path>
    <content>
    // Header component code
    </content>
    </write_to_file>
    ```

-   Search for a pattern (search_files):

    ```xml
    <search_files>
    <path>src</path>
    <regex>function\s+\w+\(</regex>
    <file_pattern>*.ts</file_pattern>
    </search_files>
    ```

-   Run a command (execute_command):
    ```xml
    <execute_command>
    <command>npm install axios</command>
    <requires_approval>false</requires_approval>
    </execute_command>
    ```

## Common Tasks

1. **Create a New Component**

    - "Create a new React component called Footer"

2. **Fix a Bug**

    - "Fix the error in src/utils/format.ts"

3. **Refactor Code**

    - "Refactor the Button component to use TypeScript"

4. **Run Commands**
    - "Run npm install to add axios"

## Getting Help

-   [Join the Discord community](https://discord.gg/cline)
-   Check the documentation
-   Provide feedback to improve Cline
