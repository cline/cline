import { z } from "zod";

/**
 * Canonical names for workspace configuration and boundary files.
 */
export const WORKSPACE_CONFIG_FILE_NAME = "workspace.json";
export const CLINE_BOUNDARY_FILE_NAME = ".cline-boundary";
export const CLINE_IGNORE_FILE_NAME = ".clineignore";

/**
 * Zod schema for .cline/workspace.json configuration.
 */
export const WorkspaceConfigSchema = z.object({
	/**
	 * Human-readable label for display in UI, CLI prompt, and status bar.
	 * Default: folder basename.
	 */
	name: z.string().optional(),

	/**
	 * Explicit sub-cline inclusion patterns (relative globs).
	 * Declares recognized child workspaces belonging to this parent.
	 * Example: ["packages/*", "apps/*", "services/core-*"]
	 */
	includes: z.array(z.string()).default([]),

	/**
	 * Directory patterns excluded from workspace resolution or layering.
	 * Example: ["apps/legacy-monolith/**", "temp-experiment"]
	 */
	ignores: z.array(z.string()).default([]),

	/**
	 * When true, this workspace will not inherit rules, skills, or settings
	 * from any parent .cline layers.
	 */
	isolated: z.boolean().default(false),

	/**
	 * Whether to inherit MCP server definitions from parent layers.
	 * Default: true.
	 */
	inheritMcpServers: z.boolean().default(true),

	/**
	 * Optional custom workspace metadata or environment variables.
	 */
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

/**
 * Represents a single layer within the workspace hierarchy.
 */
export interface WorkspaceLayer {
	/** Absolute path to the layer directory */
	path: string;
	/** Parsed workspace configuration */
	config: WorkspaceConfig;
	/** Whether this layer provides rules (.cline/rules/, .clinerules, or .cline/rules.md) */
	hasRules: boolean;
	/** Whether this layer provides skills (.cline/skills/ or .agents/skills/) */
	hasSkills: boolean;
	/** Whether this layer provides agent configurations (.cline/agents/ or .agents/) */
	hasAgents: boolean;
	/** Whether this layer provides workflows (.cline/workflows/) */
	hasWorkflows: boolean;
	/** Whether this layer contains a .git repository boundary */
	isGitRoot: boolean;
}

/**
 * The resolved hierarchical workspace context.
 */
export interface ResolvedHierarchicalWorkspace {
	/** The nearest active workspace directory (Primary Anchor) */
	primaryRoot: string;
	/** The original target directory where the session started */
	targetPath: string;
	/** Ordered list of active layers from root-most ancestor to primaryRoot */
	layers: WorkspaceLayer[];
	/** Whether an active workspace was discovered */
	isInitialized: boolean;
	/** Sub-clines discovered via `includes` patterns */
	discoveredSubClines: string[];
}

/**
 * Options for workspace hierarchy resolution.
 */
export interface ResolveWorkspaceOptions {
	/**
	 * Stop upward traversal at the containing Git root.
	 * Defaults to true.
	 */
	stopAtGitRoot?: boolean;
	/**
	 * User home directory boundary. Traversal will not ascend past this directory.
	 * Defaults to os.homedir().
	 */
	userHomeDir?: string;
	/**
	 * Optional custom fs interface for virtualized or promise-based operations.
	 */
	fs?: typeof import("node:fs/promises");
}

/**
 * Convert a glob pattern (e.g. "packages/*", "apps/**", "temp-*") into a RegExp.
 */
export function globToRegExp(pattern: string): RegExp {
	const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "").trim();
	let regexStr = "^";
	let i = 0;
	while (i < normalized.length) {
		const char = normalized[i];
		if (char === "*") {
			if (normalized[i + 1] === "*") {
				if (normalized[i + 2] === "/") {
					regexStr += "(?:.*/)?";
					i += 3;
				} else {
					regexStr += ".*";
					i += 2;
				}
			} else {
				regexStr += "[^/]*";
				i += 1;
			}
		} else if (char === "?") {
			regexStr += "[^/]";
			i += 1;
		} else if ("./+^$()[]{}\\|".includes(char)) {
			regexStr += `\\${char}`;
			i += 1;
		} else {
			regexStr += char;
			i += 1;
		}
	}
	regexStr += "$";
	return new RegExp(regexStr);
}

/**
 * Test whether a path matches a glob pattern.
 * Respects both root-relative patterns (containing "/") and basename patterns.
 */
export function matchesGlob(pattern: string, relativePath: string): boolean {
	const cleanPattern = pattern.trim().replace(/\\/g, "/").replace(/^\.\//, "");
	const cleanPath = relativePath
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\.\//, "");
	if (!cleanPattern || !cleanPath) {
		return false;
	}

	if (cleanPattern === cleanPath) {
		return true;
	}

	// Pattern ending in "/**" also matches the directory itself
	if (cleanPattern.endsWith("/**")) {
		const dirPattern = cleanPattern.slice(0, -3);
		if (cleanPath === dirPattern || cleanPath.startsWith(`${dirPattern}/`)) {
			return true;
		}
	}

	// Basename pattern (e.g. "*.log", "temp-*") without slashes matches anywhere
	if (!cleanPattern.includes("/")) {
		const lastSlash = cleanPath.lastIndexOf("/");
		const base = lastSlash >= 0 ? cleanPath.slice(lastSlash + 1) : cleanPath;
		const regex = globToRegExp(cleanPattern);
		if (regex.test(base)) {
			return true;
		}
	}

	const regex = globToRegExp(cleanPattern);
	return regex.test(cleanPath);
}

/**
 * Check if a path matches any pattern in a list of globs.
 */
export function matchesAnyGlob(
	patterns: string[],
	relativePath: string,
): boolean {
	return patterns.some((pattern) => matchesGlob(pattern, relativePath));
}
