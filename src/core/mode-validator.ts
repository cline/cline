import { Mode } from './prompts/types'
import { codeMode } from './prompts/system'
import { CODE_ALLOWED_TOOLS, READONLY_ALLOWED_TOOLS, ToolName, ReadOnlyToolName } from './tool-lists'

// Extended tool type that includes 'unknown_tool' for testing
export type TestToolName = ToolName | 'unknown_tool';

// Type guard to check if a tool is a valid tool
function isValidTool(tool: TestToolName): tool is ToolName {
    return CODE_ALLOWED_TOOLS.includes(tool as ToolName);
}

// Type guard to check if a tool is a read-only tool
function isReadOnlyTool(tool: TestToolName): tool is ReadOnlyToolName {
    return READONLY_ALLOWED_TOOLS.includes(tool as ReadOnlyToolName);
}

export function isToolAllowedForMode(toolName: TestToolName, mode: Mode): boolean {
    if (mode === codeMode) {
        return isValidTool(toolName);
    }
    // Both architect and ask modes use the same read-only tools
    return isReadOnlyTool(toolName);
}

export function validateToolUse(toolName: TestToolName, mode: Mode): void {
    if (!isToolAllowedForMode(toolName, mode)) {
        throw new Error(
            `Tool "${toolName}" is not allowed in ${mode} mode.`
        );
    }
}