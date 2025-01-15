import fs from 'fs/promises'
import path from 'path'

export async function loadRuleFiles(cwd: string): Promise<string> {
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