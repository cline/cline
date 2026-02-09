/**
 * SuccessCriteriaEvaluator - Evaluates success criteria for beads.
 *
 * Supports multiple criterion types: tests_pass, done_tag, no_errors, custom.
 */

import { spawn } from "child_process"

import { Logger } from "@shared/services/Logger"
import type { SuccessCriteriaResult, SuccessCriterion, SuccessCriterionType, BeadTestResult } from "@shared/beads"

/**
 * Context for evaluating success criteria.
 */
export interface EvaluationContext {
	/** The last response from the LLM */
	lastResponse?: string
	/** The test command to run (if tests_pass criterion) */
	testCommand?: string
	/** Files changed in this bead */
	filesChanged?: string[]
	/** Errors recorded during the bead */
	errors?: string[]
	/** Custom evaluation function */
	customEvaluator?: (context: EvaluationContext) => Promise<boolean>
}

/**
 * Result of running tests.
 */
export interface TestRunResult {
	passed: boolean
	exitCode: number
	output: string
	testResults: BeadTestResult[]
	duration: number
}

/**
 * Evaluates success criteria for beads.
 */
export class SuccessCriteriaEvaluator {
	private workspaceRoot: string
	private testTimeout: number

	constructor(workspaceRoot: string, options?: { testTimeout?: number }) {
		this.workspaceRoot = workspaceRoot
		this.testTimeout = options?.testTimeout ?? 300000 // 5 minutes default
	}

	/**
	 * Evaluate all success criteria.
	 */
	async evaluate(criteria: SuccessCriterion[], context: EvaluationContext): Promise<SuccessCriteriaResult> {
		const results: Partial<Record<SuccessCriterionType, boolean>> = {}
		let details = ""

		for (const criterion of criteria) {
			try {
				const passed = await this.evaluateCriterion(criterion, context)
				results[criterion.type] = passed

				if (!passed) {
					details += `${criterion.type}: FAILED. `
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				Logger.error(`[SuccessCriteriaEvaluator] Error evaluating ${criterion.type}:`, error)
				results[criterion.type] = false
				details += `${criterion.type}: ERROR - ${message}. `
			}
		}

		const allPassed = Object.values(results).every((v) => v === true)

		return {
			allPassed,
			results,
			details: details || (allPassed ? "All criteria passed" : undefined),
		}
	}

	/**
	 * Evaluate a single criterion.
	 */
	private async evaluateCriterion(criterion: SuccessCriterion, context: EvaluationContext): Promise<boolean> {
		switch (criterion.type) {
			case "done_tag":
				return this.evaluateDoneTag(context, criterion.config)

			case "tests_pass":
				return this.evaluateTestsPass(context, criterion.config)

			case "no_errors":
				return this.evaluateNoErrors(context)

			case "custom":
				return this.evaluateCustom(context, criterion.config)

			default:
				Logger.warn(`[SuccessCriteriaEvaluator] Unknown criterion type: ${criterion.type}`)
				return false
		}
	}

	/**
	 * Evaluate done_tag criterion - checks if DONE marker is in response.
	 */
	private evaluateDoneTag(context: EvaluationContext, config?: Record<string, unknown>): boolean {
		const response = context.lastResponse ?? ""
		const marker = (config?.marker as string) ?? "DONE"

		// Check for the marker (case-insensitive by default)
		const caseSensitive = (config?.caseSensitive as boolean) ?? false
		if (caseSensitive) {
			return response.includes(marker)
		}
		return response.toUpperCase().includes(marker.toUpperCase())
	}

	/**
	 * Evaluate tests_pass criterion - runs tests and checks exit code.
	 */
	private async evaluateTestsPass(context: EvaluationContext, config?: Record<string, unknown>): Promise<boolean> {
		const testCommand = (config?.command as string) ?? context.testCommand

		if (!testCommand) {
			Logger.debug("[SuccessCriteriaEvaluator] No test command configured, skipping tests_pass criterion")
			return true // Skip if no test command
		}

		try {
			const result = await this.runTests(testCommand)
			return result.passed
		} catch (error) {
			Logger.error("[SuccessCriteriaEvaluator] Test execution failed:", error)
			return false
		}
	}

	/**
	 * Evaluate no_errors criterion - checks if any errors were recorded.
	 */
	private evaluateNoErrors(context: EvaluationContext): boolean {
		const errors = context.errors ?? []
		return errors.length === 0
	}

	/**
	 * Evaluate custom criterion using a provided evaluator function.
	 */
	private async evaluateCustom(context: EvaluationContext, config?: Record<string, unknown>): Promise<boolean> {
		if (context.customEvaluator) {
			return context.customEvaluator(context)
		}

		// If no custom evaluator, check config for a simple condition
		if (config?.condition) {
			// Simple string matching condition
			const response = context.lastResponse ?? ""
			return response.includes(config.condition as string)
		}

		Logger.warn("[SuccessCriteriaEvaluator] No custom evaluator provided for custom criterion")
		return true
	}

	/**
	 * Run tests using the provided command.
	 */
	async runTests(command: string): Promise<TestRunResult> {
		const startTime = Date.now()

		return new Promise((resolve) => {
			let output = ""
			let exitCode = -1

			// Parse command into executable and args
			const parts = command.split(" ")
			const executable = parts[0]
			const args = parts.slice(1)

			const proc = spawn(executable, args, {
				cwd: this.workspaceRoot,
				shell: true,
				env: { ...process.env },
			})

			proc.stdout?.on("data", (data: Buffer) => {
				output += data.toString()
			})

			proc.stderr?.on("data", (data: Buffer) => {
				output += data.toString()
			})

			const timeout = setTimeout(() => {
				proc.kill()
				resolve({
					passed: false,
					exitCode: -1,
					output: output + "\n[TIMEOUT] Test execution timed out",
					testResults: [],
					duration: Date.now() - startTime,
				})
			}, this.testTimeout)

			proc.on("close", (code) => {
				clearTimeout(timeout)
				exitCode = code ?? -1

				const testResults = this.parseTestOutput(output)

				resolve({
					passed: exitCode === 0,
					exitCode,
					output,
					testResults,
					duration: Date.now() - startTime,
				})
			})

			proc.on("error", (error) => {
				clearTimeout(timeout)
				resolve({
					passed: false,
					exitCode: -1,
					output: `[ERROR] ${error.message}`,
					testResults: [],
					duration: Date.now() - startTime,
				})
			})
		})
	}

	/**
	 * Parse test output to extract individual test results.
	 * This is a basic implementation - can be extended for specific test frameworks.
	 */
	private parseTestOutput(output: string): BeadTestResult[] {
		const results: BeadTestResult[] = []

		// Try to parse Jest/Vitest style output
		const jestPattern = /(?:✓|✔|PASS|√)\s+(.+?)(?:\s+\((\d+)\s*m?s\))?$/gm
		const jestFailPattern = /(?:✗|✘|FAIL|×)\s+(.+?)(?:\s+\((\d+)\s*m?s\))?$/gm

		let match
		while ((match = jestPattern.exec(output)) !== null) {
			results.push({
				name: match[1].trim(),
				passed: true,
				duration: match[2] ? parseInt(match[2], 10) : undefined,
			})
		}

		while ((match = jestFailPattern.exec(output)) !== null) {
			results.push({
				name: match[1].trim(),
				passed: false,
				duration: match[2] ? parseInt(match[2], 10) : undefined,
			})
		}

		// Try to parse pytest style output
		const pytestPattern = /^(.+?)::\w+\s+(PASSED|FAILED|ERROR)/gm
		while ((match = pytestPattern.exec(output)) !== null) {
			results.push({
				name: match[1],
				passed: match[2] === "PASSED",
			})
		}

		return results
	}
}

/**
 * Create a SuccessCriteriaEvaluator with default settings.
 */
export function createSuccessCriteriaEvaluator(
	workspaceRoot: string,
	options?: { testTimeout?: number }
): SuccessCriteriaEvaluator {
	return new SuccessCriteriaEvaluator(workspaceRoot, options)
}
