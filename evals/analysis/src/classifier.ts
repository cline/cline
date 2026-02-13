/**
 * Failure classification system for Cline evaluations
 *
 * Classifies failures by matching log patterns against known issues:
 * - Provider bugs (Gemini #7974, Claude #7998)
 * - Transient failures (rate limits, timeouts)
 * - Infrastructure issues (harness, environment)
 * - Policy/safety refusals
 * - Auth errors
 */

import * as fs from "fs"
import * as yaml from "js-yaml"
import * as path from "path"
import type { FailureCategory, FailureInfo } from "./schemas"

export interface FailurePattern {
	name: string
	pattern: string // Regex pattern as string
	category: FailureCategory
	issue?: string // GitHub issue URL
	description: string
}

export interface FailurePatternsConfig {
	version: string
	patterns: FailurePattern[]
}

export class FailureClassifier {
	private patterns: Array<FailurePattern & { regex: RegExp }>

	constructor(patternsPath?: string) {
		const defaultPath = path.join(__dirname, "../patterns/cline-failures.yaml")
		const configPath = patternsPath || defaultPath

		const config = this.loadPatternsFromYaml(configPath)
		this.patterns = config.patterns.map((p) => ({
			...p,
			regex: new RegExp(p.pattern, "i"), // Case-insensitive matching
		}))
	}

	private loadPatternsFromYaml(filePath: string): FailurePatternsConfig {
		const content = fs.readFileSync(filePath, "utf-8")
		const config = yaml.load(content) as FailurePatternsConfig

		if (!config.version || !config.patterns) {
			throw new Error("Invalid patterns YAML: missing version or patterns")
		}

		return config
	}

	/**
	 * Classify failures in log text
	 * @param logs Full log text (e.g., cline.txt content)
	 * @returns Array of matched failure categories with excerpts
	 */
	classify(logs: string): FailureInfo[] {
		const failures: FailureInfo[] = []

		for (const pattern of this.patterns) {
			const match = pattern.regex.exec(logs)
			if (match) {
				failures.push({
					name: pattern.name,
					category: pattern.category,
					excerpt: this.extractExcerpt(logs, match.index, match[0].length),
					issue_url: pattern.issue,
				})
			}
		}

		return failures
	}

	/**
	 * Extract a context snippet around the matched pattern
	 * @param logs Full log text
	 * @param matchIndex Index where pattern matched
	 * @param matchLength Length of the matched text
	 * @returns Context snippet (up to 200 chars before/after match)
	 */
	private extractExcerpt(logs: string, matchIndex: number, matchLength: number): string {
		const contextSize = 200
		const start = Math.max(0, matchIndex - contextSize)
		const end = Math.min(logs.length, matchIndex + matchLength + contextSize)

		let excerpt = logs.slice(start, end)

		// Trim to complete lines for readability
		excerpt = excerpt.replace(/^\s*\S*\s*/, "") // Remove partial first line
		excerpt = excerpt.replace(/\s*\S*\s*$/, "") // Remove partial last line

		// Truncate if still too long
		if (excerpt.length > 400) {
			excerpt = excerpt.slice(0, 400) + "..."
		}

		return excerpt.trim()
	}

	/**
	 * Check if logs contain any known provider bug patterns
	 */
	hasProviderBug(logs: string): boolean {
		return this.classify(logs).some((f) => f.category === "provider_bug")
	}

	/**
	 * Check if logs contain transient failure patterns (retriable)
	 */
	hasTransientFailure(logs: string): boolean {
		return this.classify(logs).some((f) => f.category === "transient")
	}

	/**
	 * Get all pattern names for a specific category
	 */
	getPatternsByCategory(category: FailureCategory): string[] {
		return this.patterns.filter((p) => p.category === category).map((p) => p.name)
	}
}
