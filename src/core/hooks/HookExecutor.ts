/**
 * Hook Executor
 * Handles the execution of hook commands with timeout and error handling
 */

import { execa, type ResultPromise } from "execa"
import { HookDefinition } from "./types/HookConfiguration"
import { HookEvent } from "./types/HookEvent"
import { HookExecutionResult, parseHookOutput } from "./types/HookResponse"

export class HookExecutor {
	private readonly defaultTimeout: number

	constructor(defaultTimeout: number = 60000) {
		this.defaultTimeout = defaultTimeout
	}

	/**
	 * Execute a single hook
	 */
	async executeHook(hook: HookDefinition, event: HookEvent): Promise<HookExecutionResult> {
		const startTime = Date.now()

		try {
			// Prepare command and args
			const { command, args } = this.prepareCommand(hook.command)

			// Set up environment variables
			const env = {
				...process.env,
				...hook.environment,
				CLAUDE_PROJECT_DIR: event.cwd,
			}

			// Calculate timeout
			const timeout = (hook.timeout || 60) * 1000 // Convert to milliseconds

			// Execute the hook command
			const childProcess = execa(command, args, {
				env,
				cwd: event.cwd,
				timeout,
				reject: false, // Don't throw on non-zero exit
				buffer: true, // Buffer output for parsing
				input: JSON.stringify(event), // Pass event as JSON to stdin
			})

			// Wait for completion
			const result = await childProcess

			const executionTime = Date.now() - startTime

			// Check if timed out
			if (result.timedOut) {
				return {
					timedOut: true,
					executionTime,
				}
			}

			// Parse the output
			const hookResult = parseHookOutput(result.stdout || "", result.stderr || "", result.exitCode || 0)

			return {
				...hookResult,
				executionTime,
			}
		} catch (error) {
			const executionTime = Date.now() - startTime

			// Handle execution errors
			if ((error as any).timedOut) {
				return {
					timedOut: true,
					executionTime,
				}
			}

			return {
				error: this.formatError(error),
				exitCode: (error as any).exitCode || 1,
				executionTime,
			}
		}
	}

	/**
	 * Execute multiple hooks in parallel
	 */
	async executeHooksParallel(hooks: HookDefinition[], event: HookEvent): Promise<HookExecutionResult[]> {
		const promises = hooks.map((hook) => this.executeHook(hook, event))
		return Promise.all(promises)
	}

	/**
	 * Execute multiple hooks sequentially
	 */
	async executeHooksSequential(hooks: HookDefinition[], event: HookEvent): Promise<HookExecutionResult[]> {
		const results: HookExecutionResult[] = []

		for (const hook of hooks) {
			const result = await this.executeHook(hook, event)
			results.push(result)

			// Stop on first denial
			if (result.response && !result.response.approve) {
				break
			}
		}

		return results
	}

	/**
	 * Prepare command and arguments from hook definition
	 */
	private prepareCommand(command: string | string[]): { command: string; args: string[] } {
		if (Array.isArray(command)) {
			// Command is already split into command and args
			const [cmd, ...args] = command
			return { command: cmd, args }
		}

		// Parse command string
		// Simple parsing - doesn't handle complex quoting
		const parts = command.split(/\s+/)
		const [cmd, ...args] = parts
		return { command: cmd, args }
	}

	/**
	 * Format error for consistent error messages
	 */
	private formatError(error: unknown): string {
		if (error instanceof Error) {
			return error.message
		}
		if (typeof error === "string") {
			return error
		}
		return "Unknown error occurred"
	}

	/**
	 * Kill a running hook process
	 */
	async killProcess(childProcess: ResultPromise<any>): Promise<void> {
		if (!childProcess.killed) {
			childProcess.kill("SIGTERM")

			// Give it a moment to terminate gracefully
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Force kill if still running
			if (!childProcess.killed) {
				childProcess.kill("SIGKILL")
			}
		}
	}
}
