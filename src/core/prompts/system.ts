import defaultShell from "default-shell"
import os from "os"
import osName from "os-name"
import { McpHub } from "../../services/mcp/McpHub"
import path from "path"
import { globby } from "globby"
import fs from "fs"
import * as vscode from "vscode"

/**
 * Helper function to evaluate expressions with named modules
 */
function evaluateExpression(expr: string, context: Record<string, any>): any {
  // Create a new function with the context object names
  const func = new Function(...Object.keys(context), `return ${expr}`)
  
  // Execute the function with the context values
  return func(...Object.values(context))
}

/**
 * Get VSCode user data directory path based on current environment
 */
function getVSCodeUserDir(): string {
  const isInsiders = vscode.env.appName.includes("Insiders")
  const userDataDir = isInsiders ? ".vscode-insiders" : ".vscode"
  return path.join(os.homedir(), userDataDir)
}

/**
 * Generates the system prompt by loading and combining instruction files.
 * Entry point used by Cline to construct its behavior.
 */
export const SYSTEM_PROMPT = async (
  cwd: string,
  supportsComputerUse: boolean,
  mcpHub: McpHub,
) => {

  const eval_context = {
    // imports
    os,
    osName,
    defaultShell,

    // arrow-function args
    cwd,
    supportsComputerUse,
    mcpHub
  }
  
  /**
   * Processes template literals in instruction files
   */
  function interpolateTemplate(template: string): string {
    return template.replace(/\$\{([^}]+)\}/g, (match, expr) => {
      try {
        const result = evaluateExpression(expr.trim(), eval_context)
        return String(result)
      } catch (error) {
        console.warn(`Failed to evaluate: ${expr}`)
        return match
      }
    })
  }

  /**
   * Loads and processes instruction files
   */
  async function loadInstructionFiles(): Promise<string> {
    // Define instruction directories in priority order
    const projectInstructionsDir = path.join(cwd, ".cline", "system-instructions.d")
    const globalInstructionsDir = path.join(getVSCodeUserDir(), "cline", "system-instructions.d")
    const packageInstructionsDir = path.join("assets", "system-instructions.d")

    console.debug(`system-instructions.d/ search order:\n  - ${projectInstructionsDir}\n  - ${globalInstructionsDir}\n  - ${packageInstructionsDir}\n`)

    // Get list of files from all directories
    const projectFiles = fs.existsSync(projectInstructionsDir) ? 
      await globby("*", {
        cwd: projectInstructionsDir,
        absolute: false,
        onlyFiles: true
      }) : []

    const globalFiles = fs.existsSync(globalInstructionsDir) ?
      await globby("*", {
        cwd: globalInstructionsDir,
        absolute: false,
        onlyFiles: true
      }) : []

    const packageFiles = fs.existsSync(packageInstructionsDir) ? 
      await globby("*", {
        cwd: packageInstructionsDir,
        absolute: false,
        onlyFiles: true
      }) : []

    // Combine unique filenames, maintaining priority order
    // Later additions won't override earlier ones due to Set uniqueness
    const allFiles = [...new Set([...projectFiles, ...globalFiles, ...packageFiles])].sort()

    // Process each file
    const sections = await Promise.all(allFiles.map(async (file) => {
      let content: string
      let sourcePath = ""

      // Try loading from each location in priority order
      try {
        const projectPath = path.join(projectInstructionsDir, file)
        const globalPath = path.join(globalInstructionsDir, file)
        const packagePath = path.join(packageInstructionsDir, file)

        if (fs.existsSync(projectPath)) {
          content = await fs.promises.readFile(projectPath, "utf8")
          sourcePath = projectPath
        } else if (fs.existsSync(globalPath)) {
          content = await fs.promises.readFile(globalPath, "utf8")
          sourcePath = globalPath
        } else if (fs.existsSync(packagePath)) {
          content = await fs.promises.readFile(packagePath, "utf8")
          sourcePath = packagePath
        } else {
          console.warn(`Failed to find instruction file: ${file}`)
          return ""
        }
      } catch (error) {
        console.warn(`Failed to read instruction file: ${sourcePath}`)
        return ""
      }

      const lines = content.split("\n")
      
      // Check for condition comment and extract expression
      const conditionMatch = lines[0].match(/^\s*\/\/ @condition:\s*\$\{([^}]+)\}/)
      if (conditionMatch) {
        const condition = conditionMatch[1].trim()
        try {
          const evaluatedCondition = evaluateExpression(condition, eval_context)
          // Skip file if condition evaluates to false
          if (!evaluatedCondition) {
            return ""
          }
        } catch (error) {
          console.warn(`Failed to evaluate condition: ${condition}`)
          return ""
        }
        // Remove condition line and process content
        content = lines.slice(1).join("\n")
      }
      
      // Process content with interpolateTemplate
      const processed = interpolateTemplate(content)
      return processed + "\n"  // Add newline to ensure proper section separation
    }))

    // Combine sections with clear boundary
    const result = sections.filter(Boolean).join("\n")
    return result
  }

  // Load and process all files
  const prompt = await loadInstructionFiles()
  
  return prompt
}

/**
 * Adds custom instructions to override or extend Cline's behavior.
 * Instructions are appended after the main system prompt.
 */
export function addCustomInstructions(customInstructions: string): string {
  return `
====

USER'S CUSTOM INSTRUCTIONS

The following additional instructions are provided by the user, and should be followed to the best of your ability without interfering with the TOOL USE guidelines.

${customInstructions.trim()}`
}
