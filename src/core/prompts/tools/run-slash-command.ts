/**
 * Generates the run_slash_command tool description.
 */
export function getRunSlashCommandDescription(): string {
	return `## run_slash_command
Description: Execute a slash command to get specific instructions or content. Slash commands are predefined templates that provide detailed guidance for common tasks.

Parameters:
- command: (required) The name of the slash command to execute (e.g., "init", "test", "deploy")
- args: (optional) Additional arguments or context to pass to the command

Usage:
<run_slash_command>
<command>command_name</command>
<args>optional arguments</args>
</run_slash_command>

Examples:

1. Running the init command to analyze a codebase:
<run_slash_command>
<command>init</command>
</run_slash_command>

2. Running a command with additional context:
<run_slash_command>
<command>test</command>
<args>focus on integration tests</args>
</run_slash_command>

The command content will be returned for you to execute or follow as instructions.`
}
