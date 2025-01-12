import { Mode, codeMode } from "./modes"
import { getToolDescriptionsForMode } from "./tools"
import {
    getRulesSection,
    getSystemInfoSection,
    getObjectiveSection,
    addCustomInstructions,
    getSharedToolUseSection,
    getMcpServersSection,
    getToolUseGuidelinesSection,
    getCapabilitiesSection
} from "./sections"
import { DiffStrategy } from "../diff/DiffStrategy"
import { McpHub } from "../../services/mcp/McpHub"

export const mode: Mode = codeMode

export const CODE_PROMPT = async (
    cwd: string,
    supportsComputerUse: boolean,
    mcpHub?: McpHub,
    diffStrategy?: DiffStrategy,
    browserViewportSize?: string,
) => `You are Cline, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.

${getSharedToolUseSection()}

${getToolDescriptionsForMode(mode, cwd, supportsComputerUse, diffStrategy, browserViewportSize, mcpHub)}

${getToolUseGuidelinesSection()}

${await getMcpServersSection(mcpHub, diffStrategy)}

${getCapabilitiesSection(cwd, supportsComputerUse, mcpHub, diffStrategy)}

${getRulesSection(cwd, supportsComputerUse, diffStrategy)}

${getSystemInfoSection(cwd)}

${getObjectiveSection()}`
