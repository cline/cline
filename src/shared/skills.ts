/**
 * Execution metadata declared in skill frontmatter.
 */
export interface SkillInvocationMetadata {
	manual?: boolean
	auto?: boolean
}

/**
 * Skill metadata loaded at startup for discovery.
 * Required fields (name, description, path, source) are stable;
 * optional fields are additive and ignored by older consumers.
 */
export interface SkillMetadata {
	name: string
	description: string
	path: string
	source: "global" | "project"
	version?: number
	tags?: string[]
	tools?: string[]
	resources?: string[]
	invocation?: SkillInvocationMetadata
}

/**
 * Full skill content loaded on-demand when skill is activated.
 */
export interface SkillContent extends SkillMetadata {
	instructions: string
}
