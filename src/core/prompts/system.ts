import { DiffStrategy } from "../diff/DiffStrategy"
import { McpHub } from "../../services/mcp/McpHub"
import { CODE_PROMPT } from "./code"
import { ARCHITECT_PROMPT } from "./architect"
import { ASK_PROMPT } from "./ask"
import { Mode, codeMode, architectMode, askMode } from "./modes"
import fs from 'fs/promises'
import path from 'path'

async function loadRuleFiles(cwd: string): Promise<string> {
    const ruleFiles = ['.clinerules', '.cursorrules', '.windsurfrules']
    let combinedRules = ''

    for (const file of ruleFiles) {
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

export async function addCustomInstructions(customInstructions: string, cwd: string, preferredLanguage?: string): Promise<string> {
    const ruleFileContent = await loadRuleFiles(cwd)
    const allInstructions = []

    if (preferredLanguage) {
        allInstructions.push(`You should always speak and think in the ${preferredLanguage} language.`)
    }
    
    if (customInstructions.trim()) {
        allInstructions.push(customInstructions.trim())
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
    customPrompts?: { ask?: string; code?: string; architect?: string; enhance?: string },
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
