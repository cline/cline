import { DiffStrategy } from '../../diff/DiffStrategy'
import { McpHub } from '../../../services/mcp/McpHub'

export type ToolArgs = {
    cwd: string;
    supportsComputerUse: boolean;
    diffStrategy?: DiffStrategy;
    browserViewportSize?: string;
    mcpHub?: McpHub;
    toolOptions?: any;
};