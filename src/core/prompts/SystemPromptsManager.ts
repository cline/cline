import os from "node:os"
import path from "node:path"
import { parseYamlFrontmatter as parseYamlFrontmatterBase } from "@core/context/instructions/user-instructions/frontmatter"
import { existsSync } from "fs"
import { mkdir, readdir, readFile, writeFile } from "fs/promises"
import { Logger } from "@/shared/services/Logger"
import { ClineDefaultTool } from "@/shared/tools"
import { isLocatedInPath } from "@/utils/path"

const DEFAULT_PROMPT_ID = "default"

/**
 * Role transformation configuration for custom prompts
 * Enables semantic role changes (coder → writer → researcher)
 */
export interface RoleTransformation {
	/** New role name */
	newRole?: string
	/** Behavior archetype: affects default tool selection and communication style */
	behavior?: "coder" | "writer" | "researcher" | "analyst" | "teacher"
	/** Specific areas of expertise */
	expertise?: string[]
	/** Communication style preference */
	communicationStyle?: "formal" | "casual" | "technical" | "creative"
}

/**
 * Tool groups for granular tool selection.
 * Each group contains related tools that can be enabled/disabled together.
 * Uses ClineDefaultTool enum values to ensure consistency with tool definitions.
 */
export const TOOL_GROUPS = {
	/** File system tools: read, write, list, search */
	filesystem: [
		ClineDefaultTool.FILE_READ,
		ClineDefaultTool.FILE_NEW,
		ClineDefaultTool.FILE_EDIT,
		ClineDefaultTool.LIST_FILES,
		ClineDefaultTool.SEARCH,
		ClineDefaultTool.LIST_CODE_DEF,
		ClineDefaultTool.APPLY_PATCH,
	],
	/** Browser automation tools */
	browser: [ClineDefaultTool.BROWSER],
	/** Web access tools: fetch, search */
	web: [ClineDefaultTool.WEB_FETCH, ClineDefaultTool.WEB_SEARCH],
	/** Command execution tools */
	terminal: [ClineDefaultTool.BASH],
	/** MCP integration tools */
	mcp: [ClineDefaultTool.MCP_USE, ClineDefaultTool.MCP_ACCESS, ClineDefaultTool.MCP_DOCS],
	/** Communication tools */
	communication: [ClineDefaultTool.ASK, ClineDefaultTool.ATTEMPT],
	/** Task management tools */
	task: [ClineDefaultTool.NEW_TASK, ClineDefaultTool.PLAN_MODE, ClineDefaultTool.ACT_MODE, ClineDefaultTool.TODO],
	/** Utility tools */
	utility: [ClineDefaultTool.GENERATE_EXPLANATION, ClineDefaultTool.USE_SKILL],
} as const

export type ToolGroup = keyof typeof TOOL_GROUPS

/**
 * Tool configuration for custom prompts
 * Enables fine-grained control over available tools via groups or individual IDs
 */
export interface ToolConfiguration {
	/** Enable native tool calls (when supported by model) */
	enableNativeToolCalls?: boolean
	/**
	 * Tools/groups to enable (whitelist mode)
	 * Accepts tool IDs (e.g., "read_file") or group names prefixed with @ (e.g., "@filesystem")
	 * When specified, ONLY these tools are available
	 */
	enabled?: string[]
	/**
	 * Tools/groups to disable (blacklist mode)
	 * Accepts tool IDs (e.g., "browser_action") or group names prefixed with @ (e.g., "@browser")
	 * Applied after enabled list (if any)
	 */
	disabled?: string[]
	/** Custom instructions per tool (tool ID -> additional instructions) */
	customToolInstructions?: Record<string, string>
}

/**
 * System behavior configuration
 * Controls approval modes, YOLO, browser access
 */
export interface SystemBehavior {
	/** YOLO mode: 'enabled' = auto-approve, 'disabled' = always ask, 'conditional' = context-based */
	yoloMode?: "enabled" | "disabled" | "conditional"
	/** Approval mode for tool execution */
	approvalMode?: "always" | "never" | "conditional"
	/** Browser access level */
	browserMode?: "full" | "limited" | "disabled"
}

/**
 * Metadata configuration for custom prompts (parsed from YAML frontmatter)
 *
 * Custom prompts automatically merge with Cline's default components.
 * Use component flags and tool configuration to control what capabilities are available.
 */
export interface CustomPromptMetadata {
	/** Unique identifier for the prompt */
	name?: string
	/** Brief description of the prompt's purpose */
	description?: string
	/** Prompt version for tracking changes */
	version?: string
	/** Author information */
	author?: string

	// === Component Control ===
	/** Components to include from defaults (explicit whitelist) */
	includeComponents?: string[]
	/** Components to exclude from defaults (blacklist, applied after includeComponents) */
	excludeComponents?: string[]
	/** Custom component order (overrides default ordering) */
	componentOrder?: string[]

	// === Tool Configuration ===
	/**
	 * Granular tool configuration
	 * Controls which tools are available in the prompt
	 */
	tools?: ToolConfiguration

	// === Advanced Configuration ===
	/** Role transformation settings */
	roleTransformation?: RoleTransformation
	/** System behavior settings */
	systemBehavior?: SystemBehavior

	// === Placeholder Values ===
	/** Custom placeholder values to inject */
	placeholders?: Record<string, string>

	// === Feature Flags ===
	/** Whether to process {{PLACEHOLDER}} syntax in the prompt (default: true) */
	enablePlaceholders?: boolean
	/** Whether to include tool use instructions (default: true) */
	includeToolInstructions?: boolean
	/** Whether to include file editing guidelines (default: true) */
	includeEditingGuidelines?: boolean
	/** Whether to include browser rules when browser is enabled (default: true) */
	includeBrowserRules?: boolean
	/** Whether to include MCP integration section when MCP is configured (default: true) */
	includeMcpSection?: boolean
	/** Whether to include user instructions from cline-rules files (default: true) */
	includeUserInstructions?: boolean
	/** Whether to include rules section (default: true) */
	includeRules?: boolean
	/** Whether to include system info section (default: true) */
	includeSystemInfo?: boolean

	// === Validation ===
	/** Suppress validation warnings */
	suppressWarnings?: boolean
}

export interface SystemPrompt {
	id: string
	filename: string
	name: string
	description?: string
	enabled: boolean
	content: string
	filepath: string
	/** Parsed metadata from YAML frontmatter */
	metadata?: CustomPromptMetadata
	/** Raw content without frontmatter */
	rawContent?: string
}

/**
 * Validation result for custom prompts
 */
export interface PromptValidationResult {
	isValid: boolean
	errors: string[]
	warnings: string[]
	missingComponents: string[]
	metadata?: CustomPromptMetadata
}

/**
 * Parses YAML frontmatter from content using the shared frontmatter parser.
 * Wraps the result to match CustomPromptMetadata interface.
 */
function parseYamlFrontmatter(content: string): { metadata: CustomPromptMetadata; rawContent: string } {
	const result = parseYamlFrontmatterBase(content)

	if (result.parseError) {
		Logger.warn(`Failed to parse prompt frontmatter: ${result.parseError}`)
		return { metadata: {}, rawContent: content }
	}

	// Map parsed data to CustomPromptMetadata
	const data = result.data
	const metadata: CustomPromptMetadata = {}

	// String fields
	if (typeof data.name === "string") metadata.name = data.name
	if (typeof data.description === "string") metadata.description = data.description
	if (typeof data.version === "string") metadata.version = data.version
	if (typeof data.author === "string") metadata.author = data.author

	// Boolean fields
	if (typeof data.includeToolInstructions === "boolean") metadata.includeToolInstructions = data.includeToolInstructions
	if (typeof data.includeEditingGuidelines === "boolean") metadata.includeEditingGuidelines = data.includeEditingGuidelines
	if (typeof data.includeBrowserRules === "boolean") metadata.includeBrowserRules = data.includeBrowserRules
	if (typeof data.includeMcpSection === "boolean") metadata.includeMcpSection = data.includeMcpSection
	if (typeof data.includeUserInstructions === "boolean") metadata.includeUserInstructions = data.includeUserInstructions
	if (typeof data.includeRules === "boolean") metadata.includeRules = data.includeRules
	if (typeof data.includeSystemInfo === "boolean") metadata.includeSystemInfo = data.includeSystemInfo
	if (typeof data.enablePlaceholders === "boolean") metadata.enablePlaceholders = data.enablePlaceholders

	// Array fields
	if (Array.isArray(data.includeComponents)) metadata.includeComponents = data.includeComponents as string[]
	if (Array.isArray(data.excludeComponents)) metadata.excludeComponents = data.excludeComponents as string[]

	// Tools object
	if (data.tools && typeof data.tools === "object") {
		const tools = data.tools as Record<string, unknown>
		metadata.tools = {
			enabled: Array.isArray(tools.enabled) ? (tools.enabled as string[]) : undefined,
			disabled: Array.isArray(tools.disabled) ? (tools.disabled as string[]) : undefined,
		}
	}

	return { metadata, rawContent: result.body }
}

/**
 * Extracts name from prompt content (first # heading)
 */
function extractName(content: string, fallback: string): string {
	const match = content.match(/^#\s+(.+)$/m)
	return match ? match[1].trim() : fallback
}

/**
 * Extracts description from prompt content (first paragraph after heading)
 */
function extractDescription(content: string): string | undefined {
	const lines = content.split("\n")
	let foundHeading = false
	for (const line of lines) {
		if (line.startsWith("#")) {
			foundHeading = true
			continue
		}
		if (foundHeading && line.trim()) {
			return line.trim().substring(0, 100)
		}
	}
	return undefined
}

/**
 * Expands tool group references (e.g., "@filesystem") to individual tool IDs
 */
export function expandToolReferences(refs: string[]): string[] {
	const result: string[] = []
	for (const ref of refs) {
		if (ref.startsWith("@")) {
			const groupName = ref.slice(1) as ToolGroup
			const groupTools = TOOL_GROUPS[groupName]
			if (groupTools) {
				result.push(...groupTools)
			}
		} else {
			result.push(ref)
		}
	}
	return [...new Set(result)] // Remove duplicates
}

/**
 * Resolves which tools should be available based on tool configuration
 */
export function resolveEnabledTools(
	allTools: string[],
	toolConfig?: ToolConfiguration,
): { enabledTools: string[]; disabledTools: string[] } {
	if (!toolConfig) {
		return { enabledTools: allTools, disabledTools: [] }
	}

	let enabledTools = allTools

	// If enabled list is specified, use whitelist mode
	if (toolConfig.enabled?.length) {
		const whitelist = new Set(expandToolReferences(toolConfig.enabled))
		enabledTools = allTools.filter((tool) => whitelist.has(tool))
	}

	// Apply disabled list (blacklist)
	if (toolConfig.disabled?.length) {
		const blacklist = new Set(expandToolReferences(toolConfig.disabled))
		enabledTools = enabledTools.filter((tool) => !blacklist.has(tool))
	}

	const disabledTools = allTools.filter((tool) => !enabledTools.includes(tool))
	return { enabledTools, disabledTools }
}

/**
 * Validates a custom prompt and returns detailed results
 */
function validatePromptContent(content: string, metadata: CustomPromptMetadata): PromptValidationResult {
	const errors: string[] = []
	const warnings: string[] = []
	const missingComponents: string[] = []

	// Check for minimum content
	if (content.trim().length < 50) {
		errors.push("Prompt content is too short (minimum 50 characters)")
	}

	// Check for placeholder syntax errors
	const unmatchedPlaceholders = content.match(/\{\{[^}]*$/gm)
	if (unmatchedPlaceholders) {
		errors.push("Unmatched placeholder syntax detected: " + unmatchedPlaceholders.join(", "))
	}

	// Validate tool configuration references
	if (metadata.tools) {
		const allGroups = Object.keys(TOOL_GROUPS)
		const validateRefs = (refs?: string[]) => {
			if (!refs) return
			for (const ref of refs) {
				if (ref.startsWith("@")) {
					const groupName = ref.slice(1)
					if (!allGroups.includes(groupName)) {
						warnings.push(`Unknown tool group: ${ref}. Available groups: ${allGroups.map((g) => "@" + g).join(", ")}`)
					}
				}
			}
		}
		validateRefs(metadata.tools.enabled)
		validateRefs(metadata.tools.disabled)
	}

	return {
		isValid: errors.length === 0,
		errors,
		warnings,
		missingComponents,
		metadata,
	}
}

export class SystemPromptsManager {
	private static instance: SystemPromptsManager
	private promptsDir: string
	private activeFile: string
	private cache: Map<string, SystemPrompt> = new Map()
	private lastScan: number = 0
	private scanInterval: number = 500

	private constructor() {
		this.promptsDir = path.join(os.homedir(), ".cline", "system-prompts")
		this.activeFile = path.join(this.promptsDir, ".active")
	}

	static getInstance(): SystemPromptsManager {
		if (!SystemPromptsManager.instance) {
			SystemPromptsManager.instance = new SystemPromptsManager()
		}
		return SystemPromptsManager.instance
	}

	async ensurePromptsDir(): Promise<void> {
		if (!existsSync(this.promptsDir)) {
			await mkdir(this.promptsDir, { recursive: true })
			await this.createReadme()
		}
	}

	private async createReadme(): Promise<void> {
		const readme = `# Custom System Prompts for Cline

## Overview

Custom system prompts let you personalize Cline's behavior while automatically inheriting
essential capabilities like tool instructions, file editing guidelines, and system rules.

Your custom content is merged with Cline's default components—you define the role and 
personality, Cline handles the technical plumbing.

## Quick Start

Create a \`.md\` file in this directory with optional YAML frontmatter:

\`\`\`markdown
---
name: "Technical Writer"
description: "Documentation and content specialist"
version: "1.0"
author: "Your Name"
---

# Technical Writing Specialist

You are a technical writing expert. Your focus is on creating clear,
well-structured documentation that is accessible to all readers.

## Your Expertise
- API documentation and developer guides
- User manuals and tutorials
- Technical specifications
- Style guide compliance (Google, Microsoft, etc.)

## Communication Style
- Use plain language, avoid jargon
- Break complex topics into digestible sections
- Include practical examples
- Maintain consistency in terminology
\`\`\`

## Tool Configuration (Granular Control)

Control which tools Cline can use via the \`tools\` configuration:

\`\`\`yaml
---
name: "Read-Only Analyst"
tools:
  enabled:
    - "@filesystem"   # Enable all filesystem tools
    - "@web"          # Enable web tools
  disabled:
    - "write_to_file" # But disable writing
    - "replace_in_file"
  enableNativeToolCalls: true  # Use native tool calling when supported
---
\`\`\`

### Tool Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| \`enabled\` | string[] | Whitelist: ONLY these tools/groups are available |
| \`disabled\` | string[] | Blacklist: remove these tools/groups (applied after enabled) |
| \`enableNativeToolCalls\` | boolean | Enable native tool calling when model supports it |
| \`customToolInstructions\` | object | Custom instructions per tool (tool_id → instructions) |

### Tool Groups

Use \`@groupname\` to reference tool groups:

| Group | Tools | Description |
|-------|-------|-------------|
| @filesystem | read_file, write_to_file, replace_in_file, list_files, search_files, list_code_definition_names, apply_patch | File operations |
| @browser | browser_action | Browser automation |
| @web | web_fetch, web_search | Internet access |
| @terminal | execute_command | Shell commands |
| @mcp | use_mcp_tool, access_mcp_resource, load_mcp_documentation | MCP integration |
| @communication | ask_followup_question, attempt_completion | User interaction |
| @task | new_task, plan_mode_respond, act_mode_respond, focus_chain | Task management |
| @utility | generate_explanation, use_skill | Utilities |

### Examples

**Minimal read-only mode:**
\`\`\`yaml
tools:
  enabled: ["read_file", "list_files", "search_files", "@communication"]
\`\`\`

**Full access except browser:**
\`\`\`yaml
tools:
  disabled: ["@browser"]
\`\`\`

**Documentation writer (no code execution):**
\`\`\`yaml
tools:
  disabled: ["@terminal", "@browser"]
\`\`\`

**Custom tool instructions:**
\`\`\`yaml
tools:
  customToolInstructions:
    read_file: "Always check file encoding before reading"
    execute_command: "Prefer non-destructive commands; avoid rm, mv on important files"
\`\`\`

## Component Control

Fine-tune which default sections are included:

\`\`\`yaml
---
name: "Focused Developer"
# Include specific components (whitelist)
includeComponents:
  - TOOL_USE_SECTION
  - EDITING_FILES_SECTION
  - RULES_SECTION
  - SYSTEM_INFO_SECTION

# Or exclude specific components (blacklist)
excludeComponents:
  - MCP_SECTION
  - SKILLS_SECTION

# Custom component order (optional)
componentOrder:
  - RULES_SECTION
  - TOOL_USE_SECTION
  - SYSTEM_INFO_SECTION

# Suppress validation warnings (optional)
suppressWarnings: false
---
\`\`\`

### Component Flags (Convenience)

\`\`\`yaml
includeToolInstructions: true    # TOOL_USE_SECTION + TOOLS_SECTION
includeEditingGuidelines: true   # EDITING_FILES_SECTION
includeBrowserRules: true        # CAPABILITIES_SECTION (when browser enabled)
includeMcpSection: true          # MCP_SECTION (when MCP configured)
includeUserInstructions: true    # USER_INSTRUCTIONS_SECTION
includeRules: true               # RULES_SECTION
includeSystemInfo: true          # SYSTEM_INFO_SECTION
\`\`\`

## Available Components

| ID | Description | Included By Default |
|----|-------------|---------------------|
| AGENT_ROLE_SECTION | Base role definition | (user content replaces) |
| TOOL_USE_SECTION | How to use tools | Yes |
| TOOLS_SECTION | Available tools list | Yes |
| EDITING_FILES_SECTION | File editing guidelines | Yes |
| CAPABILITIES_SECTION | Browser/system capabilities | Yes (when browser enabled) |
| RULES_SECTION | Behavioral rules | Yes |
| SYSTEM_INFO_SECTION | OS, shell, working dir | Yes |
| MCP_SECTION | MCP server integration | Yes (when MCP configured) |
| USER_INSTRUCTIONS_SECTION | User's cline-rules | Yes |
| SKILLS_SECTION | Available skills | Yes |
| ACT_VS_PLAN_SECTION | Act vs Plan mode switching | context-dependent |
| CLI_SUBAGENTS_SECTION | CLI subagent instructions | context-dependent |
| TODO_SECTION | Focus chain/task tracking | context-dependent |
| OBJECTIVE_SECTION | Current objective | context-dependent |
| FEEDBACK_SECTION | User feedback | context-dependent |
| TASK_PROGRESS_SECTION | Task progress tracking | context-dependent |

## Placeholders

Use \`{{PLACEHOLDER}}\` syntax for dynamic values in your prompt content.

### Available Placeholders

| Placeholder | Description |
|-------------|-------------|
| \`{{CWD}}\` | Current working directory |
| \`{{CURRENT_DATE}}\` | Today's date (YYYY-MM-DD) |
| \`{{SUPPORTS_BROWSER}}\` | Browser enabled (true/false) |
| \`{{IDE}}\` | Current IDE (vscode, cursor, etc.) |
| \`{{HAS_MCP}}\` | MCP configured (true/false) |
| \`{{YOLO_MODE}}\` | YOLO mode active (true/false) |

### Placeholder Configuration

\`\`\`yaml
---
# Enable/disable placeholder processing (default: true)
enablePlaceholders: true

# Define custom placeholder values
placeholders:
  TEAM_NAME: "Platform Team"
  CODING_STANDARD: "Google Style"
---

# In your prompt content:
Working as part of {{TEAM_NAME}} following {{CODING_STANDARD}}.
\`\`\`

## Examples

### Programming: React Developer

\`\`\`markdown
---
name: "React Developer"
description: "Frontend React/TypeScript specialist"
includeEditingGuidelines: true
---

# React Development Specialist

You are a React expert working in {{CWD}}.

## Expertise
- React 18+ with hooks and modern patterns
- TypeScript with strict mode
- Testing with Jest and React Testing Library
- Performance optimization

## Approach
- Prefer functional components with hooks
- Use proper TypeScript types, avoid \`any\`
- Write self-documenting code
- Include accessibility considerations
\`\`\`

### Non-Programming: Research Analyst

\`\`\`markdown
---
name: "Research Analyst"
tools:
  enabled: ["@web", "@filesystem", "@communication"]
  disabled: ["@terminal"]
---

# Research Analyst

You are a research analyst helping with information gathering and analysis.

## Capabilities
- Search and synthesize information from multiple sources
- Create structured research reports
- Analyze data and identify patterns
- Cite sources properly

## Guidelines
- Verify information from multiple sources
- Present balanced perspectives
- Clearly distinguish facts from opinions
- Note limitations of available data
\`\`\`

### Non-Programming: Content Strategist

\`\`\`markdown
---
name: "Content Strategist"
tools:
  enabled: ["@filesystem", "@web", "@communication"]
---

# Content Strategist

You help plan and organize content for various platforms.

## Focus Areas
- Content calendars and editorial planning
- SEO optimization recommendations
- Audience analysis and targeting
- Content performance metrics

## Deliverables
- Content briefs and outlines
- Editorial guidelines
- Platform-specific recommendations
- Content audit reports
\`\`\`

### Non-Programming: Legal Document Reviewer

\`\`\`markdown
---
name: "Legal Reviewer"
tools:
  enabled: ["read_file", "search_files", "@communication"]
---

# Legal Document Reviewer

You review legal documents for clarity, consistency, and potential issues.

## Review Focus
- Contract terms and conditions
- Compliance requirements
- Ambiguous language
- Missing or unclear clauses

## Important
- Flag items requiring attorney review
- Do not provide legal advice
- Note jurisdiction-specific considerations
\`\`\`

## File Management

- **Location**: \`~/.cline/system-prompts/\`
- **Format**: Markdown (.md) with optional YAML frontmatter
- **Encoding**: UTF-8
- **Naming**: Use descriptive names (e.g., \`react-developer.md\`)
- **Activation**: Select in Cline Settings > Custom Prompts

## Activating a Prompt

1. Create your \`.md\` file in this directory
2. Go to Cline Settings > Custom Prompts  
3. Click refresh to see your prompt
4. Select it from the dropdown

## Tips

1. **Start simple** - Add complexity gradually
2. **Use tool groups** - Easier than listing individual tools
3. **Test incrementally** - Verify behavior after changes
4. **Back up working prompts** - Use version control
5. **Use placeholders** - Make prompts dynamic and reusable
`
		await writeFile(path.join(this.promptsDir, "README.md"), readme, "utf-8")
	}

	/**
	 * Gets the currently active prompt ID
	 */
	async getActivePromptId(): Promise<string> {
		try {
			await this.ensurePromptsDir()
			if (existsSync(this.activeFile)) {
				const activeId = (await readFile(this.activeFile, "utf-8")).trim()
				return activeId || DEFAULT_PROMPT_ID
			}
		} catch (error) {
			Logger.warn("Failed to read active prompt:", error)
		}
		return DEFAULT_PROMPT_ID
	}

	/**
	 * Scans and returns all available prompts
	 */
	async scanPrompts(forceRefresh: boolean = false): Promise<SystemPrompt[]> {
		const now = Date.now()

		if (!forceRefresh && now - this.lastScan < this.scanInterval && this.cache.size > 0) {
			return Array.from(this.cache.values())
		}

		try {
			await this.ensurePromptsDir()
			const activeId = await this.getActivePromptId()

			const files = await readdir(this.promptsDir)
			const mdFiles = files.filter((f) => f.endsWith(".md") && f !== "README.md")

			const prompts: SystemPrompt[] = []

			for (const file of mdFiles) {
				try {
					const filepath = path.join(this.promptsDir, file)
					const content = await readFile(filepath, "utf-8")
					const id = file.replace(".md", "")

					// Parse YAML frontmatter for metadata
					const { metadata, rawContent } = parseYamlFrontmatter(content)

					const prompt: SystemPrompt = {
						id,
						filename: file,
						name: metadata.name || extractName(rawContent, id),
						description: metadata.description || extractDescription(rawContent),
						enabled: id === activeId,
						content,
						filepath,
						metadata,
						rawContent,
					}

					prompts.push(prompt)
					this.cache.set(id, prompt)
				} catch (error) {
					Logger.warn(`Failed to load prompt ${file}:`, error)
				}
			}

			// Clean up cache for deleted files
			const currentIds = new Set(prompts.map((p) => p.id))
			for (const cachedId of this.cache.keys()) {
				if (!currentIds.has(cachedId)) {
					this.cache.delete(cachedId)
				}
			}

			this.lastScan = now
			return prompts
		} catch (error) {
			Logger.error("Failed to scan prompts:", error)
			return []
		}
	}

	/**
	 * Gets the active custom prompt content, or null if using default
	 */
	async getActivePrompt(): Promise<string | null> {
		const activeId = await this.getActivePromptId()

		if (activeId === DEFAULT_PROMPT_ID) {
			return null
		}

		const promptPath = path.resolve(this.promptsDir, `${activeId}.md`)
		if (!isLocatedInPath(this.promptsDir, promptPath)) {
			Logger.warn(`Invalid active prompt path detected: ${activeId}`)
			return null
		}
		if (!existsSync(promptPath)) {
			Logger.warn(`Active prompt file not found: ${promptPath}`)
			return null
		}

		try {
			const content = await readFile(promptPath, "utf-8")
			if (content.length > 100000) {
				Logger.warn(`Prompt ${activeId} is too large (>100KB)`)
				return null
			}
			return content.trim()
		} catch (error) {
			Logger.error(`Failed to read active prompt:`, error)
			return null
		}
	}

	/**
	 * Activates a prompt by ID
	 */
	async activatePrompt(promptId: string): Promise<void> {
		await this.ensurePromptsDir()

		// Validate prompt exists (unless default)
		if (promptId !== DEFAULT_PROMPT_ID) {
			const promptPath = path.resolve(this.promptsDir, `${promptId}.md`)
			if (!isLocatedInPath(this.promptsDir, promptPath)) {
				throw new Error(`Invalid prompt ID: ${promptId}`)
			}
			if (!existsSync(promptPath)) {
				throw new Error(`Prompt file not found: ${promptId}.md`)
			}
		}

		await writeFile(this.activeFile, promptId, "utf-8")
		Logger.log(`Activated system prompt: ${promptId}`)

		// Clear cache to force refresh
		this.clearCache()
	}

	/**
	 * Deactivates all custom prompts (returns to default)
	 */
	async deactivateAll(): Promise<void> {
		await this.activatePrompt(DEFAULT_PROMPT_ID)
	}

	getPromptsDirectory(): string {
		return this.promptsDir
	}

	clearCache(): void {
		this.cache.clear()
		this.lastScan = 0
	}

	/**
	 * Gets the active prompt with parsed metadata
	 * Returns both the processed content and metadata for hybrid composition
	 */
	async getActivePromptWithMetadata(): Promise<{
		content: string
		rawContent: string
		metadata: CustomPromptMetadata
	} | null> {
		const activeId = await this.getActivePromptId()

		if (activeId === DEFAULT_PROMPT_ID) {
			return null
		}

		const promptPath = path.resolve(this.promptsDir, `${activeId}.md`)
		if (!isLocatedInPath(this.promptsDir, promptPath)) {
			Logger.warn(`Invalid active prompt path detected: ${activeId}`)
			return null
		}
		if (!existsSync(promptPath)) {
			Logger.warn(`Active prompt file not found: ${promptPath}`)
			return null
		}

		try {
			const content = await readFile(promptPath, "utf-8")
			if (content.length > 100000) {
				Logger.warn(`Prompt ${activeId} is too large (>100KB)`)
				return null
			}

			const { metadata, rawContent } = parseYamlFrontmatter(content)
			return {
				content: content.trim(),
				rawContent: rawContent.trim(),
				metadata,
			}
		} catch (error) {
			Logger.error(`Failed to read active prompt:`, error)
			return null
		}
	}

	/**
	 * Validates a prompt file and returns detailed validation results
	 */
	async validatePrompt(promptId: string): Promise<PromptValidationResult> {
		const promptPath = path.resolve(this.promptsDir, `${promptId}.md`)
		if (!isLocatedInPath(this.promptsDir, promptPath)) {
			return {
				isValid: false,
				errors: ["Invalid prompt ID (path traversal detected)"],
				warnings: [],
				missingComponents: [],
			}
		}

		if (!existsSync(promptPath)) {
			return {
				isValid: false,
				errors: [`Prompt file not found: ${promptId}.md`],
				warnings: [],
				missingComponents: [],
			}
		}

		try {
			const content = await readFile(promptPath, "utf-8")
			const { metadata, rawContent } = parseYamlFrontmatter(content)
			return validatePromptContent(rawContent, metadata)
		} catch (error) {
			return {
				isValid: false,
				errors: [`Failed to read prompt: ${error}`],
				warnings: [],
				missingComponents: [],
			}
		}
	}

	/**
	 * Gets a specific prompt by ID with parsed metadata
	 */
	async getPromptById(promptId: string): Promise<SystemPrompt | null> {
		// Check cache first
		if (this.cache.has(promptId)) {
			return this.cache.get(promptId) || null
		}

		// Load from disk
		const promptPath = path.resolve(this.promptsDir, `${promptId}.md`)
		if (!isLocatedInPath(this.promptsDir, promptPath)) {
			return null
		}
		if (!existsSync(promptPath)) {
			return null
		}

		try {
			const content = await readFile(promptPath, "utf-8")
			const { metadata, rawContent } = parseYamlFrontmatter(content)
			const activeId = await this.getActivePromptId()

			return {
				id: promptId,
				filename: `${promptId}.md`,
				name: metadata.name || extractName(rawContent, promptId),
				description: metadata.description || extractDescription(rawContent),
				enabled: promptId === activeId,
				content,
				filepath: promptPath,
				metadata,
				rawContent,
			}
		} catch (error) {
			Logger.warn(`Failed to load prompt ${promptId}:`, error)
			return null
		}
	}

	/**
	 * Creates a new prompt file with optional metadata
	 */
	async createPrompt(
		name: string,
		content: string,
		metadata?: Partial<CustomPromptMetadata>,
	): Promise<{ success: boolean; id: string; error?: string }> {
		await this.ensurePromptsDir()

		// Generate ID from name (sanitize)
		const id = name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")

		if (!id) {
			return { success: false, id: "", error: "Invalid prompt name" }
		}

		const promptPath = path.join(this.promptsDir, `${id}.md`)
		if (existsSync(promptPath)) {
			return { success: false, id, error: "Prompt already exists" }
		}

		try {
			// Build content with frontmatter if metadata provided
			let finalContent = content
			if (metadata && Object.keys(metadata).length > 0) {
				const frontmatter = this.buildFrontmatter({ ...metadata, name })
				finalContent = `${frontmatter}\n${content}`
			}

			await writeFile(promptPath, finalContent, "utf-8")
			this.clearCache()
			return { success: true, id }
		} catch (error) {
			return { success: false, id, error: `Failed to create prompt: ${error}` }
		}
	}

	/**
	 * Builds YAML frontmatter from metadata object
	 */
	private buildFrontmatter(metadata: CustomPromptMetadata): string {
		const lines: string[] = ["---"]

		const addField = (key: string, value: unknown, indent = 0) => {
			if (value === undefined || value === null) return
			const prefix = "  ".repeat(indent)

			if (typeof value === "boolean") {
				lines.push(`${prefix}${key}: ${value}`)
			} else if (typeof value === "number") {
				lines.push(`${prefix}${key}: ${value}`)
			} else if (Array.isArray(value)) {
				if (value.length === 0) return
				lines.push(`${prefix}${key}:`)
				for (const item of value) {
					lines.push(`${prefix}  - ${item}`)
				}
			} else if (typeof value === "object") {
				lines.push(`${prefix}${key}:`)
				for (const [k, v] of Object.entries(value)) {
					if (Array.isArray(v)) {
						addField(k, v, indent + 1)
					} else {
						lines.push(`${prefix}  ${k}: ${v}`)
					}
				}
			} else {
				lines.push(`${prefix}${key}: "${value}"`)
			}
		}

		// Add fields in logical order
		addField("name", metadata.name)
		addField("description", metadata.description)
		addField("version", metadata.version)
		addField("author", metadata.author)

		// Tool configuration
		if (metadata.tools) {
			addField("tools", metadata.tools)
		}

		// Component control
		addField("includeComponents", metadata.includeComponents)
		addField("excludeComponents", metadata.excludeComponents)

		// Feature flags
		addField("enablePlaceholders", metadata.enablePlaceholders)
		addField("includeToolInstructions", metadata.includeToolInstructions)
		addField("includeEditingGuidelines", metadata.includeEditingGuidelines)
		addField("includeBrowserRules", metadata.includeBrowserRules)
		addField("includeMcpSection", metadata.includeMcpSection)
		addField("includeUserInstructions", metadata.includeUserInstructions)
		addField("includeRules", metadata.includeRules)
		addField("includeSystemInfo", metadata.includeSystemInfo)

		lines.push("---")
		return lines.join("\n")
	}

	/**
	 * Updates an existing prompt file
	 */
	async updatePrompt(promptId: string, content: string): Promise<{ success: boolean; error?: string }> {
		const promptPath = path.resolve(this.promptsDir, `${promptId}.md`)

		if (!isLocatedInPath(this.promptsDir, promptPath)) {
			Logger.warn(`Invalid prompt path detected: ${promptId}`)
			return { success: false, error: "Invalid prompt ID" }
		}

		if (!existsSync(promptPath)) {
			return { success: false, error: "Prompt file not found" }
		}

		try {
			await writeFile(promptPath, content, "utf-8")
			this.clearCache()
			return { success: true }
		} catch (error) {
			return { success: false, error: `Failed to update prompt: ${error}` }
		}
	}

	/**
	 * Deletes a prompt file
	 */
	async deletePrompt(promptId: string): Promise<{ success: boolean; error?: string }> {
		const promptPath = path.resolve(this.promptsDir, `${promptId}.md`)

		if (!isLocatedInPath(this.promptsDir, promptPath)) {
			Logger.warn(`Invalid prompt path detected: ${promptId}`)
			return { success: false, error: "Invalid prompt ID" }
		}

		if (!existsSync(promptPath)) {
			return { success: false, error: "Prompt file not found" }
		}

		try {
			// Deactivate if this was the active prompt
			const activeId = await this.getActivePromptId()
			if (activeId === promptId) {
				await this.deactivateAll()
			}

			const { unlink } = await import("fs/promises")
			await unlink(promptPath)
			this.clearCache()
			return { success: true }
		} catch (error) {
			return { success: false, error: `Failed to delete prompt: ${error}` }
		}
	}
}

export const systemPromptsManager = SystemPromptsManager.getInstance()
