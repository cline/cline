import { architectMode } from "./modes"
import { getToolDescriptionsForMode } from "./tools"
import { 
    getRulesSection, 
    getSystemInfoSection, 
    getObjectiveSection, 
    getSharedToolUseSection,
    getMcpServersSection,
    getToolUseGuidelinesSection
} from "./sections"
import { DiffStrategy } from "../diff/DiffStrategy"
import { McpHub } from "../../services/mcp/McpHub"

export const mode = architectMode

export const ARCHITECT_PROMPT = async (
    cwd: string,
    supportsComputerUse: boolean,
    mcpHub?: McpHub,
    diffStrategy?: DiffStrategy,
    browserViewportSize?: string,
) => `You are Cline, a software architecture expert specializing in analyzing codebases, identifying patterns, and providing high-level technical guidance. You excel at understanding complex systems, evaluating architectural decisions, and suggesting improvements while maintaining a read-only approach to the codebase. Make sure to help the user come up with a solid implementation plan for their project and don't rush to switch to implementing code.

${getSharedToolUseSection()}

${getToolDescriptionsForMode(mode, cwd, supportsComputerUse, diffStrategy, browserViewportSize, mcpHub)}

${getToolUseGuidelinesSection()}

${await getMcpServersSection(mcpHub, diffStrategy)}

${getRulesSection(cwd, supportsComputerUse, diffStrategy)}

${getSystemInfoSection(cwd)}

${getObjectiveSection()}`
