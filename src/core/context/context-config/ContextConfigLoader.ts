import * as fs from "fs/promises"
import * as path from "path"
import { ContextConfig, DEFAULT_CONFIG } from "./ContextConfig"

/**
 * Loads and caches .clinecontext configuration files
 */
export class ContextConfigLoader {
	private configCache: Map<string, ContextConfig> = new Map()

	/**
	 * Load context configuration from workspace root
	 * Checks for both .clinecontext and .clinecontext.json
	 * Falls back to DEFAULT_CONFIG on errors
	 *
	 * @param workspaceRoot - Absolute path to workspace root directory
	 * @returns Parsed configuration or default config
	 */
	async loadConfig(workspaceRoot: string): Promise<ContextConfig> {
		// Check cache first
		const cached = this.configCache.get(workspaceRoot)
		if (cached) {
			return cached
		}

		// Try loading config files in order of preference
		const configFiles = [".clinecontext", ".clinecontext.json"]

		for (const configFile of configFiles) {
			const configPath = path.join(workspaceRoot, configFile)

			try {
				const content = await fs.readFile(configPath, "utf-8")
				const config = this.parseConfig(content)

				// Cache the successfully loaded config
				this.configCache.set(workspaceRoot, config)
				return config
			} catch (error) {}
		}

		// No config file found, use defaults
		this.configCache.set(workspaceRoot, DEFAULT_CONFIG)
		return DEFAULT_CONFIG
	}

	/**
	 * Parse config content, stripping // comments before JSON parsing
	 *
	 * @param content - Raw file content
	 * @returns Parsed configuration
	 * @throws Error if JSON parsing fails
	 */
	private parseConfig(content: string): ContextConfig {
		try {
			// Strip // style comments (but preserve URLs like https://)
			const stripped = this.stripComments(content)

			// Parse JSON
			const parsed = JSON.parse(stripped)

			// Merge with defaults to ensure all required fields exist
			return this.mergeWithDefaults(parsed)
		} catch (error) {
			console.error("Failed to parse .clinecontext file:", error)
			return DEFAULT_CONFIG
		}
	}

	/**
	 * Strip // style comments from JSON content
	 * Preserves // in strings (like URLs)
	 *
	 * @param content - Raw JSON content with comments
	 * @returns Content with comments removed
	 */
	private stripComments(content: string): string {
		const lines = content.split("\n")
		const strippedLines = lines.map((line) => {
			// Find // outside of strings
			let inString = false
			let escapeNext = false
			let commentStart = -1

			for (let i = 0; i < line.length; i++) {
				const char = line[i]

				if (escapeNext) {
					escapeNext = false
					continue
				}

				if (char === "\\") {
					escapeNext = true
					continue
				}

				if (char === '"') {
					inString = !inString
					continue
				}

				if (!inString && char === "/" && line[i + 1] === "/") {
					commentStart = i
					break
				}
			}

			if (commentStart >= 0) {
				return line.substring(0, commentStart).trimEnd()
			}

			return line
		})

		return strippedLines.join("\n")
	}

	/**
	 * Merge parsed config with defaults to ensure all fields exist
	 *
	 * @param parsed - Partially parsed config
	 * @returns Complete config with defaults filled in
	 */
	private mergeWithDefaults(parsed: Partial<ContextConfig>): ContextConfig {
		return {
			includeVisibleFiles: parsed.includeVisibleFiles ?? DEFAULT_CONFIG.includeVisibleFiles,
			includeOpenTabs: parsed.includeOpenTabs ?? DEFAULT_CONFIG.includeOpenTabs,
			includeFileTree: parsed.includeFileTree ?? DEFAULT_CONFIG.includeFileTree,
			fileTreeStyle: parsed.fileTreeStyle ?? DEFAULT_CONFIG.fileTreeStyle,
			workdir: {
				maxFileCount: parsed.workdir?.maxFileCount ?? DEFAULT_CONFIG.workdir.maxFileCount,
				includePatterns: parsed.workdir?.includePatterns ?? DEFAULT_CONFIG.workdir.includePatterns,
				excludePatterns: parsed.workdir?.excludePatterns ?? DEFAULT_CONFIG.workdir.excludePatterns,
			},
		}
	}

	/**
	 * Clear the configuration cache
	 * Useful for testing or when config files change
	 */
	clearCache(): void {
		this.configCache.clear()
	}

	/**
	 * Clear cache for a specific workspace
	 *
	 * @param workspaceRoot - Absolute path to workspace root directory
	 */
	clearCacheForWorkspace(workspaceRoot: string): void {
		this.configCache.delete(workspaceRoot)
	}
}
