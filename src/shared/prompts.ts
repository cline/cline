// Model Family enum (used by system prompt variants)
export enum ModelFamily {
	CLAUDE = "claude",
	GPT = "gpt",
	GPT_5 = "gpt-5",
	NATIVE_GPT_5 = "gpt-5-native",
	NATIVE_GPT_5_1 = "gpt-5-1-native",
	GEMINI = "gemini",
	GEMINI_3 = "gemini3",
	QWEN = "qwen",
	GLM = "glm",
	HERMES = "hermes",
	DEVSTRAL = "devstral",
	NEXT_GEN = "next-gen",
	TRINITY = "trinity",
	GENERIC = "generic",
	XS = "xs",
	NATIVE_NEXT_GEN = "native-next-gen",
}

/**
 * Types for the Prompts Library feature
 * Defines data structures for community prompts and team prompts
 */

export interface PromptItem {
	promptId: string // unique identifier (e.g., "web-developer-vanilla-stack")
	githubUrl: string // source URL in prompts repo
	name: string // display name
	author: string // author name
	description: string // short description
	category: string // e.g., "Web Development", "Python", "Workflows"
	tags: string[] // searchable tags
	type: "rule" | "workflow" // distinguishes .clinerules from workflows
	content: string // the actual prompt/rule content (markdown)
	version?: string // semver version if available
	globs?: string[] // file patterns from frontmatter
	createdAt: string // ISO date string
	updatedAt: string // ISO date string
}

export interface PromptsCatalog {
	items: PromptItem[]
	lastUpdated: string
}

export interface TeamPrompt {
	id: string
	organizationId: string
	name: string
	description: string
	content: string
	type: "rule" | "workflow"
	category: string
	tags: string[]
	author: string
	createdAt: string
	updatedAt: string
	shared: boolean // whether it's shared with the team
}

export interface TeamPromptsCatalog {
	items: TeamPrompt[]
	organizationId: string
}

export type PromptsViewTab = "library" | "team"
