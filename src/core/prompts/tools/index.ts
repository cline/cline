import { getExecuteCommandDescription } from './execute-command'
import { getReadFileDescription } from './read-file'
import { getWriteToFileDescription } from './write-to-file'
import { getSearchFilesDescription } from './search-files'
import { getListFilesDescription } from './list-files'
import { getListCodeDefinitionNamesDescription } from './list-code-definition-names'
import { getBrowserActionDescription } from './browser-action'
import { getAskFollowupQuestionDescription } from './ask-followup-question'
import { getAttemptCompletionDescription } from './attempt-completion'
import { getUseMcpToolDescription } from './use-mcp-tool'
import { getAccessMcpResourceDescription } from './access-mcp-resource'
import { DiffStrategy } from '../../diff/DiffStrategy'
import { McpHub } from '../../../services/mcp/McpHub'
import { Mode, ToolName, getModeConfig, isToolAllowedForMode } from '../../../shared/modes'
import { ToolArgs } from './types'

// Map of tool names to their description functions
const toolDescriptionMap: Record<string, (args: ToolArgs) => string | undefined> = {
    'execute_command': args => getExecuteCommandDescription(args),
    'read_file': args => getReadFileDescription(args),
    'write_to_file': args => getWriteToFileDescription(args),
    'search_files': args => getSearchFilesDescription(args),
    'list_files': args => getListFilesDescription(args),
    'list_code_definition_names': args => getListCodeDefinitionNamesDescription(args),
    'browser_action': args => getBrowserActionDescription(args),
    'ask_followup_question': () => getAskFollowupQuestionDescription(),
    'attempt_completion': () => getAttemptCompletionDescription(),
    'use_mcp_tool': args => getUseMcpToolDescription(args),
    'access_mcp_resource': args => getAccessMcpResourceDescription(args),
    'apply_diff': args => args.diffStrategy ? args.diffStrategy.getToolDescription({ cwd: args.cwd, toolOptions: args.toolOptions }) : ''
};

export function getToolDescriptionsForMode(
    mode: Mode,
    cwd: string,
    supportsComputerUse: boolean,
    diffStrategy?: DiffStrategy,
    browserViewportSize?: string,
    mcpHub?: McpHub
): string {
    const config = getModeConfig(mode);
    const args: ToolArgs = {
        cwd,
        supportsComputerUse,
        diffStrategy,
        browserViewportSize,
        mcpHub
    };

    // Map tool descriptions in the exact order specified in the mode's tools array
    const descriptions = config.tools.map(([toolName, toolOptions]) => {
        const descriptionFn = toolDescriptionMap[toolName];
        if (!descriptionFn || !isToolAllowedForMode(toolName as ToolName, mode)) {
            return undefined;
        }

        return descriptionFn({
            ...args,
            toolOptions
        });
    });

    return `# Tools\n\n${descriptions.filter(Boolean).join('\n\n')}`;
}

// Export individual description functions for backward compatibility
export {
    getExecuteCommandDescription,
    getReadFileDescription,
    getWriteToFileDescription,
    getSearchFilesDescription,
    getListFilesDescription,
    getListCodeDefinitionNamesDescription,
    getBrowserActionDescription,
    getAskFollowupQuestionDescription,
    getAttemptCompletionDescription,
    getUseMcpToolDescription,
    getAccessMcpResourceDescription
}