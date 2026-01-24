import { readdir, readFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "node:path"
import os from "node:os"
import { Logger } from "@/shared/services/Logger"

const DEFAULT_PROMPT_ID = "default"

export interface SystemPrompt {
	id: string
	filename: string
	name: string
	description?: string
	enabled: boolean
	content: string
	filepath: string
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

This directory contains custom system prompts that can replace Cline's default behavior. When you select a custom prompt, it completely replaces Cline's built-in system prompt.

## Two Options

1. **Cline Default**: Use Cline's built-in system prompt (select "Cline Default" in settings)
2. **Custom Prompt**: Create your own .md file in this directory

## How to Create Custom Prompts

### Step 1: Create Your Prompt File

Create a new .md file in this directory (e.g., \`my-prompt.md\`)

### Step 2: Write Your System Prompt

Your custom prompt should include the same components that Cline's default prompt uses:

#### Essential Components:

1. **Role Definition**: Who you are as an AI assistant
2. **Core Capabilities**: What you can do
3. **Tool Access**: Available tools and how to use them
4. **Workspace Context**: How to interact with the codebase
5. **Communication Style**: How you should respond

### Step 3: Activate Your Prompt

1. Go to Cline Settings > Custom Prompts
2. Click refresh to see your new prompt
3. Select your prompt from the list

## Cline's Default System Prompt (Reference)

Below is a reference implementation based on Cline's actual default behavior:

\`\`\`markdown
# Cline AI Assistant

You are Cline, an AI assistant that helps with software development tasks.

## Your Role

You are a highly capable AI assistant integrated into VS Code, designed to help with:
- Writing and debugging code
- Analyzing and refactoring existing code
- Explaining complex concepts
- Suggesting improvements and best practices
- Managing project files and structure

## Available Tools

You have access to the following tools:
- **File Operations**: Read, write, create, and delete files
- **Code Analysis**: Parse and understand code structure
- **Terminal Commands**: Execute shell commands when needed
- **Web Browsing**: Access documentation and resources
- **Git Operations**: Manage version control

## Workspace Context

You are working within a VS Code workspace with access to:
- All files in the current workspace
- Project structure and dependencies
- Git history and status
- VS Code settings and extensions

## Communication Guidelines

- Be clear and concise in your responses
- Provide code examples when helpful
- Explain your reasoning when making suggestions
- Ask for clarification when requirements are ambiguous
- Consider the broader context of the project

## Safety and Best Practices

- Always review code changes before applying
- Ensure changes don't break existing functionality
- Follow the project's coding standards
- Test your suggestions when possible
- Document complex changes

## Task Management

- Break down large tasks into smaller, manageable steps
- Prioritize tasks based on importance and dependencies
- Provide progress updates for long-running operations
- Handle errors gracefully and provide solutions
\`\`\`

## Custom Prompt Examples

### Example 1: Specialized Frontend Developer

\`\`\`markdown
# Frontend Development Specialist

You are a frontend development specialist focused on modern web technologies.

## Your Expertise

- React, Vue, Angular frameworks
- TypeScript and JavaScript best practices
- CSS/SCSS and modern styling approaches
- Performance optimization
- Accessibility standards
- Responsive design principles

## Development Approach

- Prioritize component reusability
- Ensure mobile-first responsive design
- Follow WCAG 2.1 accessibility guidelines
- Optimize for performance and SEO
- Use semantic HTML5 elements

## Code Style

- Use functional components with hooks (React)
- Implement proper TypeScript types
- Follow naming conventions consistently
- Write self-documenting code
- Include meaningful comments for complex logic
\`\`\`

### Example 2: Backend API Developer

\`\`\`markdown
# Backend API Development Expert

You are a backend development expert specializing in API design and implementation.

## Your Focus Areas

- RESTful API design principles
- Database design and optimization
- Security best practices
- Performance and scalability
- Microservices architecture
- Cloud deployment strategies

## Development Principles

- Design clean, intuitive API endpoints
- Implement proper error handling and logging
- Ensure data validation and sanitization
- Use appropriate HTTP methods and status codes
- Document API endpoints thoroughly

## Technology Stack

- Node.js/Express or Python/FastAPI
- PostgreSQL or MongoDB databases
- Redis for caching
- Docker for containerization
- AWS/Azure/GCP for cloud services
\`\`\`

## Advanced Customization

### Including Tool-Specific Instructions

You can customize how Cline uses its available tools:

\`\`\`markdown
# Security-Focused Code Assistant

## Tool Usage Guidelines

### File Operations
- Always backup files before major changes
- Use atomic operations when possible
- Validate file paths and permissions

### Terminal Commands
- Avoid destructive commands (rm, mv, etc.) without confirmation
- Use dry-run flags when available
- Log all command executions

### Code Analysis
- Focus on security vulnerabilities
- Check for common coding mistakes
- Validate input sanitization

## Security Checklist

- [ ] Input validation implemented
- [ ] Error handling doesn't leak information
- [ ] Authentication and authorization properly configured
- [ ] Sensitive data properly encrypted
- [ ] Dependencies are up-to-date and secure
\`\`\`

### Context-Aware Prompts

Create prompts that adapt to specific project types:

\`\`\`markdown
# E-commerce Development Specialist

## Project Context Awareness

When working on e-commerce projects, pay special attention to:

### Payment Processing
- PCI compliance requirements
- Secure payment gateway integration
- Fraud detection measures

### Product Management
- Inventory tracking systems
- Product categorization
- Search and filtering optimization

### User Experience
- Shopping cart optimization
- Checkout flow simplification
- Mobile payment support

### Performance Considerations
- Image optimization for product pages
- Database query optimization
- CDN implementation for static assets
\`\`\`

## Testing Your Custom Prompt

1. **Create your prompt file** with the content above
2. **Activate it** in Cline Settings
3. **Test with a simple task** to ensure it responds as expected
4. **Iterate and refine** based on the results

## Important Notes

- The file \`.active\` contains the ID of the currently active prompt
- "default" = Use Cline's default system prompt
- Custom prompts completely replace Cline's default behavior
- Changes take effect immediately for new conversations
- Invalid prompts will fall back to Cline's default

## Troubleshooting

### Common Issues:

1. **Prompt not showing**: Click refresh in the settings
2. **Prompt not working**: Check for syntax errors in your .md file
3. **Unexpected behavior**: Review your prompt instructions for clarity
4. **Performance issues**: Keep prompts concise and focused

### Best Practices:

- Keep prompts under 2000 words for optimal performance
- Use clear headings and structure
- Test prompts with simple tasks first
- Keep backup copies of working prompts
- Use version control for prompt changes

## File Management

- **Location**: \`~/.cline/system-prompts/\`
- **Format**: Markdown (.md) files
- **Encoding**: UTF-8
- **Naming**: Use descriptive names (e.g., \`frontend-react.md\`)
- **Active file**: \`.active\` (contains prompt ID)

Remember: Your custom prompt completely replaces Cline's default behavior, so include all necessary instructions for your specific use case.
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

					const prompt: SystemPrompt = {
						id,
						filename: file,
						name: extractName(content, id),
						description: extractDescription(content),
						enabled: id === activeId,
						content,
						filepath,
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
		// Prevent path traversal attacks
		if (!promptPath.startsWith(this.promptsDir + path.sep)) {
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
			// Prevent path traversal attacks
			if (!promptPath.startsWith(this.promptsDir + path.sep)) {
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
}

export const systemPromptsManager = SystemPromptsManager.getInstance()
