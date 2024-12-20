import defaultShell from "default-shell"
import os from "os"
import osName from "os-name"
import { McpHub } from "../../services/mcp/McpHub"
import path from "path"
import { globby } from "globby"
import fs from "fs"
import * as vscode from "vscode"
import { ClineProvider } from "../webview/ClineProvider"

/**
 * Gets a comma-separated list of MCP server names, or "(None running currently)" if none
 */
function getMcpHubServerNames(mcpHub: McpHub): string {
  return mcpHub.getServers().map(server => server.name).join(", ") || "(None running currently)"
}

/**
 * Generates a formatted string describing the status of connected MCP servers
 */
function getMcpHubServerStatus(mcpHub: McpHub): string {
  if (mcpHub.getServers().length === 0) {
    return "(No MCP servers currently connected)"
  }

  return mcpHub.getServers()
    .filter(server => server.status === "connected")
    .map(server => {
      const tools = server.tools
        ?.map(tool => {
          const schemaStr = tool.inputSchema
            ? `    Input Schema:
    ${JSON.stringify(tool.inputSchema, null, 2).split("\n").join("\n    ")}`
            : ""

          return `- ${tool.name}: ${tool.description}\n${schemaStr}`
        })
        .join("\n\n")

      const templates = server.resourceTemplates
        ?.map(template => `- ${template.uriTemplate} (${template.name}): ${template.description}`)
        .join("\n")

      const resources = server.resources
        ?.map(resource => `- ${resource.uri} (${resource.name}): ${resource.description}`)
        .join("\n")

      const config = JSON.parse(server.config)

      return (
        `## ${server.name} (\`${config.command}${config.args && Array.isArray(config.args) ? ` ${config.args.join(" ")}` : ""}\`)` +
        (tools ? `\n\n### Available Tools\n${tools}` : "") +
        (templates ? `\n\n### Resource Templates\n${templates}` : "") +
        (resources ? `\n\n### Direct Resources\n${resources}` : "")
      )
    })
    .join("\n\n")
}


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
export const SYSTEM_PROMPT = async (providerRef: WeakRef<ClineProvider>, variables: Record<string, any>) => {
  // Resolve any promise values needed for templates
  const mcpServersPath = await variables.mcpHub?.getMcpServersPath()
  const mcpSettingsFilePath = await variables.mcpHub?.getMcpSettingsFilePath()

  const eval_context = {
    // imports
    os,
    osName,
    defaultShell,

    // Helper functions
    getMcpHubServerStatus,
    getMcpHubServerNames,

    // Resolved MCP values
    mcpServersPath,
    mcpSettingsFilePath,

    // All template variables
    ...variables
  }
  
  /**
   * Processes template literals in instruction files.
   * 
   * Template Format:
   * - ${ expr } - Will be evaluated and replaced with the result
   *   Example: ${ await mcpHub.getMcpServersPath() }
   * 
   * - \${expr} - Will be skipped (not evaluated)
   *   Example: `console.log(\${value})`
   * 
   * This allows template expressions to be used for dynamic content while preserving
   * template literals in code examples. The key differences are:
   * 1. Template expressions use a space after ${
   * 2. Code examples escape the $ with a backslash
   * 
   * The negative lookbehind (?<!\\) in the regex ensures we only match unescaped ${
   * expressions, leaving escaped ones untouched.
   */
  function interpolateTemplate(template: string): string {
    return template.replace(/(?<!\\)\$\{([^}]+)\}/g, (match, expr) => {
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
    // Get extension path for packaged assets
    const provider = providerRef.deref()
    if (!provider) {
      throw new Error("Provider reference is not valid")
    }

    // Define instruction directories in priority order
    const projectInstructionsDir = path.join(variables.cwd, ".cline", "system-instructions.d")
    const globalInstructionsDir = path.join(getVSCodeUserDir(), "cline", "system-instructions.d")
    const packageInstructionsDir = path.join(provider.context.extensionUri.fsPath, "assets", "system-instructions.d")

    console.debug('VSCode Current working directory:', process.cwd())
    console.debug('Extension URI:', provider.context.extensionUri.toString())
    console.debug('Project directory:', variables.cwd)
    console.debug(`system-instructions.d/ search order:
      - ${projectInstructionsDir}
      - ${globalInstructionsDir}
      - ${packageInstructionsDir}
      `)

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
        console.warn(`Failed to read instruction file: ${sourcePath}`, error)
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
          console.warn(`Failed to evaluate condition: ${condition}`, error)
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
