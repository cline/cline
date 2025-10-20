/**
 * Plugin System Prompt Component
 *
 * Generates the system prompt section describing available plugin capabilities.
 * This allows the LLM to discover and use plugin tools dynamically.
 */

import type { PromptVariant, SystemPromptContext } from "../types"

/**
 * Get the plugin section for the system prompt.
 * Includes all registered plugins and their capabilities.
 *
 * @param variant - The prompt variant being generated
 * @param context - The system prompt context containing pluginHub
 * @returns Formatted plugin section string, or undefined if no plugins
 */
export async function getPluginSection(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	// Return undefined if plugin hub not available or no plugins registered
	const pluginHub = context.pluginHub
	if (!pluginHub || pluginHub.getPluginCount() === 0) {
		return undefined
	}

	const pluginPrompts = pluginHub.getPluginPrompts()

	if (!pluginPrompts) {
		return undefined
	}

	return `
# Plugin Extensions

The following plugin extensions are available to extend your capabilities:

${pluginPrompts}

## Using Plugin Capabilities

To use a plugin capability, use the plugin_execute tool:

<plugin_execute>
<plugin_id>The plugin ID (e.g., "cline-python-env")</plugin_id>
<capability_name>The capability name (e.g., "getPythonEnvironment")</capability_name>
<parameters>
{
  "param1": "value1",
  "param2": "value2"
}
</parameters>
</plugin_execute>

The <parameters> field should contain a JSON object with the required and optional parameters as defined by the capability. If no parameters are required, you can omit the <parameters> field or pass an empty object {}.

Plugin capabilities are particularly useful for:
- Accessing runtime environment information (e.g., Python/Node versions, installed packages)
- Integrating with other VS Code extensions' APIs
- Performing domain-specific operations not available through standard tools
- Querying external services and APIs

Always check the capability's parameter definitions and examples before using it to ensure correct usage.
`
}
