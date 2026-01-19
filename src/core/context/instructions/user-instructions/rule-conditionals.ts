/**
 * Rule frontmatter conditional evaluation.
 *
 * This module implements a small conditional "DSL" for Cline Rules YAML frontmatter.
 * It is used to decide whether a rule should be activated for a given request context.
 *
 * Notes:
 * - Unknown conditional keys are ignored for forward compatibility.
 * - The `paths` conditional matches if any candidate path matches any glob pattern.
 * - Candidate paths are expected to be workspace-root-relative POSIX paths.
 */
import * as path from "path"
import picomatch from "picomatch"

export type RuleEvaluationContext = {
	/**
	 * Candidate workspace-relative paths that represent the current request context.
	 * These should be POSIX-style paths, relative to their workspace root.
	 */
	paths?: string[]
}

export type ConditionalEvaluator = (frontmatterValue: unknown, context: RuleEvaluationContext) => boolean

type MatchedConditions = Record<string, string[]>

type ConditionalEvaluatorResult = {
	passed: boolean
	matched?: string[]
}

type ConditionalEvaluatorWithMatch = (frontmatterValue: unknown, context: RuleEvaluationContext) => ConditionalEvaluatorResult

function toPosix(p: string): string {
	return p.replace(/\\/g, "/")
}

function isNonEmptyStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string" && v.length > 0)
}

const evaluatePathsConditional: ConditionalEvaluatorWithMatch = (frontmatterValue: unknown, context: RuleEvaluationContext) => {
	// Invalid type -> ignore conditional (fail-open)
	if (!isNonEmptyStringArray(frontmatterValue)) {
		return { passed: true }
	}

	const patterns = frontmatterValue.map((p) => p.trim()).filter(Boolean)
	// Policy:
	// - `paths` omitted => universal (because this evaluator is never invoked)
	// - `paths: []` (or `paths` that trims to no usable patterns) => match nothing (fail-closed)
	//   This gives users an explicit way to disable a rule via frontmatter, while omission
	//   remains the mechanism for "always on" rules.
	if (patterns.length === 0) {
		return { passed: false }
	}

	const candidatePaths = (context.paths || []).map((p) => toPosix(p)).filter(Boolean)
	// Conservative: no evidence => do not activate path-scoped rules
	if (candidatePaths.length === 0) {
		return { passed: false }
	}

	const matchedPatterns: string[] = []

	for (const pattern of patterns) {
		const matcher = picomatch(pattern, { dot: true })
		if (candidatePaths.some((candidate) => matcher(candidate))) {
			matchedPatterns.push(pattern)
		}
	}

	return { passed: matchedPatterns.length > 0, matched: matchedPatterns.length > 0 ? matchedPatterns : undefined }
}

const conditionalEvaluators: Record<string, ConditionalEvaluatorWithMatch> = {
	paths: evaluatePathsConditional,
}

export function evaluateRuleConditionals(
	frontmatter: Record<string, unknown>,
	context: RuleEvaluationContext,
): {
	passed: boolean
	matchedConditions: MatchedConditions
} {
	const matchedConditions: MatchedConditions = {}

	for (const [key, value] of Object.entries(frontmatter)) {
		const evaluator = conditionalEvaluators[key]
		if (!evaluator) {
			continue // unknown conditional: ignore
		}

		const result = evaluator(value, context)
		if (!result.passed) {
			return { passed: false, matchedConditions: {} }
		}
		if (result.matched && result.matched.length > 0) {
			matchedConditions[key] = result.matched
		}
	}

	return { passed: true, matchedConditions }
}

/**
 * Extracts path-like strings from user text to help enable first-turn activation.
 * This is intentionally heuristic and conservative.
 */
export function extractPathLikeStrings(text: string): string[] {
	if (!text) return []

	// 1) Remove URLs to avoid false positives.
	const withoutUrls = text.replace(/\b\w+:\/\/[^\s]+/g, " ")

	// 2) Match tokens that look like paths.
	//    - Either contain at least one slash (e.g. src/index.ts)
	//    - Or look like a simple filename with an extension (e.g. foo.md)
	//      (no slashes; conservative to reduce false positives).
	const tokenRegex =
		/(?:^|[\s([{"'`])((?:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\/?|[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,10}))(?=$|[\s)\]}"'`,.;:!?])/g
	const matches: string[] = []
	let match: RegExpExecArray | null
	while ((match = tokenRegex.exec(withoutUrls))) {
		const candidate = match[1]
		if (!candidate) continue
		// Normalize away leading ./
		const normalized = candidate.startsWith("./") ? candidate.slice(2) : candidate
		// Avoid absurdly long tokens
		if (normalized.length > 300) continue
		matches.push(normalized)
	}

	// De-dupe while preserving order
	const seen = new Set<string>()
	const result: string[] = []
	for (const m of matches) {
		const posix = m.replace(/\\/g, "/")
		if (posix === "/" || posix.startsWith("/") || posix.includes("..")) {
			// We only want repo/workspace-relative hints here.
			continue
		}
		if (!seen.has(posix)) {
			seen.add(posix)
			result.push(posix)
		}
	}
	return result
}

/**
 * Normalize an absolute filesystem path to a workspace-root-relative POSIX path.
 * Returns undefined if the absolute path is not within the given root.
 */
export function toWorkspaceRelativePosixPath(absPath: string, workspaceRoot: string): string | undefined {
	const rel = path.relative(workspaceRoot, absPath)
	// Outside the root
	if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined
	return toPosix(rel)
}
