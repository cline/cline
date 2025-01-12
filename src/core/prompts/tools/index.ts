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
import { Mode, codeMode, askMode } from '../modes'
import { CODE_ALLOWED_TOOLS, READONLY_ALLOWED_TOOLS, ToolName, ReadOnlyToolName } from '../../tool-lists'

type AllToolNames = ToolName | ReadOnlyToolName;

// Helper function to safely check if a tool is allowed
function hasAllowedTool(tools: readonly string[], tool: AllToolNames): boolean {
    return tools.includes(tool);
}

export function getToolDescriptionsForMode(
    mode: Mode,
    cwd: string,
    supportsComputerUse: boolean,
    diffStrategy?: DiffStrategy,
    browserViewportSize?: string,
    mcpHub?: McpHub
): string {
    const descriptions = []

    const allowedTools = mode === codeMode ? CODE_ALLOWED_TOOLS : READONLY_ALLOWED_TOOLS;

    // Core tools based on mode
    if (hasAllowedTool(allowedTools, 'execute_command')) {
        descriptions.push(getExecuteCommandDescription(cwd));
    }
    if (hasAllowedTool(allowedTools, 'read_file')) {
        descriptions.push(getReadFileDescription(cwd));
    }
    if (hasAllowedTool(allowedTools, 'write_to_file')) {
        descriptions.push(getWriteToFileDescription(cwd));
    }

    // Optional diff strategy
    if (diffStrategy && hasAllowedTool(allowedTools, 'apply_diff')) {
        descriptions.push(diffStrategy.getToolDescription(cwd));
    }

    // File operation tools
    if (hasAllowedTool(allowedTools, 'search_files')) {
        descriptions.push(getSearchFilesDescription(cwd));
    }
    if (hasAllowedTool(allowedTools, 'list_files')) {
        descriptions.push(getListFilesDescription(cwd));
    }
    if (hasAllowedTool(allowedTools, 'list_code_definition_names')) {
        descriptions.push(getListCodeDefinitionNamesDescription(cwd));
    }

    // Browser actions
    if (supportsComputerUse && hasAllowedTool(allowedTools, 'browser_action')) {
        descriptions.push(getBrowserActionDescription(cwd, browserViewportSize));
    }

    // Common tools at the end
    if (hasAllowedTool(allowedTools, 'ask_followup_question')) {
        descriptions.push(getAskFollowupQuestionDescription());
    }
    if (hasAllowedTool(allowedTools, 'attempt_completion')) {
        descriptions.push(getAttemptCompletionDescription());
    }

    // MCP tools if available
    if (mcpHub) {
        if (hasAllowedTool(allowedTools, 'use_mcp_tool')) {
            descriptions.push(getUseMcpToolDescription());
        }
        if (hasAllowedTool(allowedTools, 'access_mcp_resource')) {
            descriptions.push(getAccessMcpResourceDescription());
        }
    }

    return `# Tools\n\n${descriptions.filter(Boolean).join('\n\n')}`
}

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