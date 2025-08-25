import { Command } from "./commands"

interface BuiltInCommandDefinition {
	name: string
	description: string
	argumentHint?: string
	content: string
}

const BUILT_IN_COMMANDS: Record<string, BuiltInCommandDefinition> = {
	init: {
		name: "init",
		description: "Analyze codebase and create concise AGENTS.md files for AI assistants",
		content: `<task>
Please analyze this codebase and create an AGENTS.md file containing:
1. Build/lint/test commands - especially for running a single test
2. Code style guidelines including imports, formatting, types, naming conventions, error handling, etc.
</task>

<initialization>
		<purpose>
		  Create (or update) a concise AGENTS.md file that enables immediate productivity for AI assistants.
		  Focus on project-specific, non-obvious information. Prioritize brevity and scannability.
		  
		  Usage notes:
		  - The file you create will be given to agentic coding agents (such as yourself) that operate in this repository
		  - Keep the main AGENTS.md concise - aim for about 20 lines, but use more if the project complexity requires it
		  - If there's already an AGENTS.md, improve it
		  - If there are Claude Code rules (in CLAUDE.md), Cursor rules (in .cursor/rules/ or .cursorrules), or Copilot rules (in .github/copilot-instructions.md), make sure to include them
		  - Be sure to prefix the file with: "# AGENTS.md\\n\\nThis file provides guidance to agents when working with code in this repository."
		</purpose>
  
  <todo_list_creation>
    If the update_todo_list tool is available, create a todo list with these focused analysis steps:
    
    1. Quick scan for existing docs
       - AI assistant rules (.cursorrules, CLAUDE.md, AGENTS.md, .roorules)
       - README and key documentation
    
    2. Identify stack
       - Language, framework, build tools
       - Package manager and dependencies
    
    3. Extract commands
       - Build, test, lint, run
       - Critical directory-specific commands
    
    4. Map core architecture
       - Main components and flow
       - Key entry points
    
    5. Document critical patterns
       - Project-specific utilities
       - Non-standard approaches
    
    6. Extract code style
       - From config files only
       - Key conventions
    
    7. Testing specifics
       - Framework and run commands
       - Directory requirements
    
    8. Compile concise AGENTS.md
       - Essential sections only
       - Brief, scannable format
       - Project-specific focus
       
    9. Create mode-specific rule directories
       - Create directory structures for the four core modes: .roo/rules-code/, .roo/rules-ask/, .roo/rules-architect/, .roo/rules-debug/
       - Create mode-specific AGENTS.md files with rules specific to that mode's purpose and capabilities
       - These rules should provide additive context and not just repeat the mode definitions
       - Only include rules that you have high confidence are accurate, valuable, and non-obvious
       
    Note: If update_todo_list is not available, proceed with the analysis workflow directly without creating a todo list.
  </todo_list_creation>
</initialization>

<analysis_workflow>
  Follow the comprehensive analysis workflow to:
  
  1. **Discovery Phase**: Find existing documentation and AI assistant rules
  2. **Project Identification**: Identify language, stack, and build system
  3. **Command Extraction**: Extract and verify essential commands
  4. **Architecture Mapping**: Create visual flow diagrams of core processes
  5. **Component Analysis**: Document key components and their interactions
  6. **Pattern Analysis**: Identify project-specific patterns and conventions
  7. **Code Style Extraction**: Extract formatting and naming conventions
  8. **Security & Performance**: Document critical patterns if relevant
  9. **Testing Discovery**: Understand testing setup and practices
  10. **Example Extraction**: Find real examples from the codebase
</analysis_workflow>

<output_structure>
  <main_file>
    Create AGENTS.md with:
    - Header: "# AGENTS.md\\n\\nThis file provides guidance to agents when working with code in this repository."
    - Project overview (brief description, core functionality, key technologies)
    - Build/lint/test commands - especially for running a single test
    - Code style guidelines including imports, formatting, types, naming conventions, error handling, etc.
    - Architecture overview (visual flow diagrams using ASCII/markdown)
    - Development guides (step-by-step for common tasks)
    - Project-specific patterns (custom utilities, non-standard approaches)
    - Testing guidelines (how to write and run tests)
    - Critical rules (must-follow requirements)
    
    Keep it concise (aim for ~20 lines, but expand as needed for complex projects) and focused on essential, project-specific information.
    Include existing AI assistant rules from CLAUDE.md, Cursor rules (.cursor/rules/ or .cursorrules), or Copilot rules (.github/copilot-instructions.md).
  </main_file>
  
  <mode_specific_files>
    Additionally, create mode-specific rule directories and AGENTS.md files.
    For the complete list of available modes with detailed descriptions, refer to the system prompt.
    The system prompt contains comprehensive information about each mode's purpose, when to use it, and its specific capabilities.
    
    Example structure:
    \`\`\`
    AGENTS.md                    # General project guidance
    .roo/
    ├── rules-code/
    │   └── AGENTS.md           # Code mode specific instructions
    ├── rules-debug/
    │   └── AGENTS.md           # Debug mode specific instructions
    ├── rules-ask/
    │   └── AGENTS.md           # Ask mode specific instructions
    └── rules-architect/
        └── AGENTS.md           # Architect mode specific instructions
    \`\`\`
    
    Create mode-specific AGENTS.md files in:
    
    .roo/rules-code/AGENTS.md - Project-specific coding rules:
    - Custom utilities that must be used
    - API patterns and retry mechanisms
    - UI component guidelines
    - Database query patterns
    - Provider implementation requirements
    - Test coverage requirements
    
    Example of actual rules to document:
    \`\`\`
    # Project Coding Rules
    - All API calls must use the retry mechanism in src/api/providers/utils/
    - UI components should use Tailwind CSS classes, not inline styles
    - New providers must implement the Provider interface in packages/types/src/
    - Database queries must use the query builder in packages/evals/src/db/queries/
    - Always use safeWriteJson() from src/utils/ instead of JSON.stringify for file writes
    - Test coverage required for all new features in src/ and webview-ui/
    \`\`\`
    
    .roo/rules-debug/AGENTS.md - Project-specific debugging approaches:
    - Where to find logs and debug output
    - Common debugging tools and commands
    - Test patterns for reproducing issues
    - Database and migration debugging
    - IPC and communication debugging
    - Build-specific debugging tips
    
    Example of actual rules to document:
    \`\`\`
    # Project Debug Rules
    - Check VSCode extension logs in the Debug Console
    - For webview issues, inspect the webview dev tools via Command Palette
    - Provider issues: check src/api/providers/__tests__/ for similar test patterns
    - Database issues: run migrations in packages/evals/src/db/migrations/
    - IPC communication issues: review packages/ipc/src/ message patterns
    - Always reproduce in both development and production extension builds
    \`\`\`
    
    .roo/rules-ask/AGENTS.md - Project documentation context:
    - Repository structure explanation
    - Where to find examples and patterns
    - Key documentation locations
    - Build and test command references
    - Localization and i18n patterns
    - Architecture-specific explanations
    
    Example of actual rules to document:
    \`\`\`
    # Project Documentation Rules
    - Reference the monorepo structure: src/ (VSCode extension), apps/ (web apps), packages/ (shared)
    - Explain provider patterns by referencing existing ones in src/api/providers/
    - For UI questions, reference webview-ui/ React components and their patterns
    - Point to package.json scripts for build/test commands
    - Reference locales/ for i18n patterns when discussing translations
    - Always mention the VSCode webview architecture when discussing UI
    \`\`\`
    
    .roo/rules-architect/AGENTS.md - Project architectural considerations:
    - Extension and plugin architecture
    - State management patterns
    - Database schema requirements
    - Package organization rules
    - API compatibility requirements
    - Performance and scaling considerations
    
    Example of actual rules to document:
    \`\`\`
    # Project Architecture Rules
    - New features must work within VSCode extension + webview architecture
    - Provider implementations must be stateless and cacheable
    - UI state management uses React hooks, not external state libraries
    - Database schema changes require migrations in packages/evals/src/db/migrations/
    - New packages must follow the existing monorepo structure in packages/
    - API changes must maintain backward compatibility with existing provider contracts
    \`\`\`
  </mode_specific_files>
</output_structure>

<quality_criteria>
  - Include visual flow diagrams (ASCII/markdown) for architecture
  - Provide actionable, step-by-step guides
  - Focus on non-obvious, project-specific information
  - Include real code examples from the project
  - Be concise and scannable
  - Adapt to the specific project needs
  - Document only what's essential for productivity
</quality_criteria>

Remember: The goal is to create documentation that enables AI assistants to be immediately productive in this codebase, focusing on project-specific knowledge that isn't obvious from the code structure alone.`,
	},
}

/**
 * Get all built-in commands as Command objects
 */
export async function getBuiltInCommands(): Promise<Command[]> {
	return Object.values(BUILT_IN_COMMANDS).map((cmd) => ({
		name: cmd.name,
		content: cmd.content,
		source: "built-in" as const,
		filePath: `<built-in:${cmd.name}>`,
		description: cmd.description,
		argumentHint: cmd.argumentHint,
	}))
}

/**
 * Get a specific built-in command by name
 */
export async function getBuiltInCommand(name: string): Promise<Command | undefined> {
	const cmd = BUILT_IN_COMMANDS[name]
	if (!cmd) return undefined

	return {
		name: cmd.name,
		content: cmd.content,
		source: "built-in" as const,
		filePath: `<built-in:${name}>`,
		description: cmd.description,
		argumentHint: cmd.argumentHint,
	}
}

/**
 * Get names of all built-in commands
 */
export async function getBuiltInCommandNames(): Promise<string[]> {
	return Object.keys(BUILT_IN_COMMANDS)
}
