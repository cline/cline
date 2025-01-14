import { DiffStrategy } from "../diff/DiffStrategy"
import { McpHub } from "../../services/mcp/McpHub"
import { CODE_PROMPT } from "./code"
import { ARCHITECT_PROMPT } from "./architect"
import { ASK_PROMPT } from "./ask"
import { Mode, codeMode, architectMode, askMode } from "./modes"
import { CustomPrompts } from "../../shared/modes"
import fs from 'fs/promises'
import path from 'path'

async function loadRuleFiles(cwd: string, mode: Mode): Promise<string> {
    let combinedRules = ''

    // First try mode-specific rules
    const modeSpecificFile = `.clinerules-${mode}`
    try {
        const content = await fs.readFile(path.join(cwd, modeSpecificFile), 'utf-8')
        if (content.trim()) {
            combinedRules += `\n# Rules from ${modeSpecificFile}:\n${content.trim()}\n`
        }
    } catch (err) {
        // Silently skip if file doesn't exist
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err
        }
    }

    // Then try generic rules files
    const genericRuleFiles = ['.clinerules']
    for (const file of genericRuleFiles) {
        try {
            const content = await fs.readFile(path.join(cwd, file), 'utf-8')
            if (content.trim()) {
                combinedRules += `\n# Rules from ${file}:\n${content.trim()}\n`
            }
        } catch (err) {
            // Silently skip if file doesn't exist
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err
            }
        }
    }

    return combinedRules
}

interface State {
    customInstructions?: string;
    customPrompts?: CustomPrompts;
    preferredLanguage?: string;
}

export async function addCustomInstructions(
    state: State,
    cwd: string,
    mode: Mode = codeMode
): Promise<string> {
    const ruleFileContent = await loadRuleFiles(cwd, mode)
    const allInstructions = []

    if (state.preferredLanguage) {
        allInstructions.push(`You should always speak and think in the ${state.preferredLanguage} language.`)
    }

    if (state.customInstructions?.trim()) {
        allInstructions.push(state.customInstructions.trim())
    }

    if (state.customPrompts?.[mode]?.customInstructions?.trim()) {
        allInstructions.push(state.customPrompts[mode].customInstructions.trim())
    }

    if (ruleFileContent && ruleFileContent.trim()) {
        allInstructions.push(ruleFileContent.trim())
    }

    const joinedInstructions = allInstructions.join('\n\n')

    return joinedInstructions ? `
====

USER'S CUSTOM INSTRUCTIONS

The following additional instructions are provided by the user, and should be followed to the best of your ability without interfering with the TOOL USE guidelines.

${joinedInstructions}`
        : ""
}

export const SYSTEM_PROMPT = async (
    cwd: string,
    supportsComputerUse: boolean,
    mcpHub?: McpHub,
    diffStrategy?: DiffStrategy,
    browserViewportSize?: string,
    mode: Mode = codeMode,
    customPrompts?: CustomPrompts,
) => {
    switch (mode) {
        case architectMode:
            return ARCHITECT_PROMPT(cwd, supportsComputerUse, mcpHub, diffStrategy, browserViewportSize, customPrompts?.architect)
        case askMode:
            return ASK_PROMPT(cwd, supportsComputerUse, mcpHub, diffStrategy, browserViewportSize, customPrompts?.ask)
        default:
            return CODE_PROMPT(cwd, supportsComputerUse, mcpHub, diffStrategy, browserViewportSize, customPrompts?.code)
    }
}

export { codeMode, architectMode, askMode }
