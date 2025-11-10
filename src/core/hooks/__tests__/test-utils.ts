import * as fs from "fs/promises"
import * as path from "path"
import should from "should"
import { HookOutput } from "../../../shared/proto/cline/hooks"
import { Hooks, NamedHookInput } from "../hook-factory"

// Define HookName locally since it's not exported from hook-factory
type HookName = keyof Hooks

/**
 * Creates a hooks directory structure at the specified location.
 *
 * @param baseDir Base directory where .clinerules/hooks will be created
 * @returns Path to the created hooks directory
 *
 * @example
 * const hooksDir = await createHooksDirectory("/tmp/test")
 * // Returns: "/tmp/test/.clinerules/hooks"
 */
export async function createHooksDirectory(baseDir: string): Promise<string> {
	const hooksDir = path.join(baseDir, ".clinerules", "hooks")
	await fs.mkdir(hooksDir, { recursive: true })
	return hooksDir
}

/**
 * Creates a test hook script with the specified output behavior.
 * Generates executable scripts for the embedded shell architecture.
 * Note: Windows support requires embedded shell implementation.
 *
 * @param baseDir Base directory (typically tempDir from test environment)
 * @param hookName Name of the hook (e.g., "PreToolUse", "PostToolUse")
 * @param output The JSON output the hook should return
 * @param options Optional configuration for hook behavior
 * @returns Path to the created hook script
 *
 * @example
 * // Create a simple success hook
 * await createTestHook(tempDir, "PreToolUse", {
 *   cancel: false,
 *   contextModification: "TEST_CONTEXT"
 * })
 *
 * @example
 * // Create a hook that delays before responding
 * await createTestHook(tempDir, "PreToolUse", {
 *   cancel: false
 * }, { delay: 100 })
 *
 * @example
 * // Create a hook that exits with an error
 * await createTestHook(tempDir, "PreToolUse", {
 *   cancel: true
 * }, { exitCode: 1 })
 *
 * @example
 * // Create a hook with custom Node.js code
 * await createTestHook(tempDir, "PreToolUse", {}, {
 *   customNodeCode: "console.log('custom behavior'); process.exit(0);"
 * })
 */
export async function createTestHook(
	baseDir: string,
	hookName: string,
	output: Partial<HookOutput>,
	options: {
		delay?: number
		exitCode?: number
		malformedJson?: boolean
		customNodeCode?: string
		exitWithoutOutput?: boolean
	} = {},
): Promise<string> {
	const hooksDir = await createHooksDirectory(baseDir)
	const scriptContent = generateHookScript(output, options)

	// Create uniform shell script (works on all platforms via embedded shell)
	return writeShellHook(hooksDir, hookName, scriptContent)
}

/**
 * Generates an executable Node.js script with shebang.
 */
function generateHookScript(
	output: Partial<HookOutput>,
	options: {
		delay?: number
		exitCode?: number
		malformedJson?: boolean
		customNodeCode?: string
		exitWithoutOutput?: boolean
	},
): string {
	let script = "#!/usr/bin/env node\n"

	// If custom Node.js code is provided, use it directly
	if (options.customNodeCode) {
		return script + options.customNodeCode
	}

	// If exitWithoutOutput is true, just exit
	if (options.exitWithoutOutput) {
		return script + "process.exit(0);\n"
	}

	if (options.delay) {
		script += `setTimeout(() => {\n`
	}

	if (options.malformedJson) {
		script += `  console.log("not valid json");\n`
	} else {
		script += `  console.log(JSON.stringify(${JSON.stringify(output)}));\n`
	}

	if (options.exitCode !== undefined) {
		script += `  process.exit(${options.exitCode});\n`
	}

	if (options.delay) {
		script += `}, ${options.delay});\n`
	}

	return script
}

/**
 * Writes an executable hook script.
 */
async function writeShellHook(hooksDir: string, hookName: string, scriptContent: string): Promise<string> {
	const scriptPath = path.join(hooksDir, hookName)
	await fs.writeFile(scriptPath, scriptContent)
	await fs.chmod(scriptPath, 0o755)
	return scriptPath
}

/**
 * Builds a complete HookInput object for PreToolUse testing.
 *
 * @param params Partial parameters to customize the input
 * @returns Complete HookInput ready for runner.run()
 *
 * @example
 * const input = buildPreToolUseInput({
 *   toolName: "write_to_file",
 *   parameters: { path: "test.ts", content: "test" }
 * })
 */
export function buildPreToolUseInput(params: {
	toolName: string
	parameters?: Record<string, any>
	taskId?: string
}): NamedHookInput<"PreToolUse"> {
	return {
		taskId: params.taskId || "test-task-id",
		preToolUse: {
			toolName: params.toolName,
			parameters: params.parameters || {},
		},
	}
}

/**
 * Builds a complete HookInput object for PostToolUse testing.
 *
 * @param params Partial parameters to customize the input
 * @returns Complete HookInput ready for runner.run()
 *
 * @example
 * const input = buildPostToolUseInput({
 *   toolName: "write_to_file",
 *   result: "File created successfully",
 *   success: true
 * })
 */
export function buildPostToolUseInput(params: {
	toolName: string
	parameters?: Record<string, any>
	result?: string
	success?: boolean
	executionTimeMs?: number
	taskId?: string
}): NamedHookInput<"PostToolUse"> {
	return {
		taskId: params.taskId || "test-task-id",
		postToolUse: {
			toolName: params.toolName,
			parameters: params.parameters || {},
			result: params.result || "",
			success: params.success ?? true,
			executionTimeMs: params.executionTimeMs ?? 100,
		},
	}
}

/**
 * Assertion helper for HookOutput validation.
 * Compares actual output against expected partial output.
 *
 * @param actual The actual hook output received
 * @param expected The expected hook output (partial match)
 *
 * @example
 * assertHookOutput(result, {
 *   cancel: false,
 *   contextModification: "Expected context"
 * })
 */
export function assertHookOutput(actual: HookOutput, expected: Partial<HookOutput>): void {
	if (expected.cancel !== undefined) {
		if (actual.cancel !== expected.cancel) {
			throw new Error(
				`Hook output assertion failed for 'cancel':\n` +
					`  Expected: ${expected.cancel}\n` +
					`  Received: ${actual.cancel}\n` +
					`  Full output: ${JSON.stringify(actual, null, 2)}`,
			)
		}
	}

	if (expected.contextModification !== undefined) {
		if (actual.contextModification !== expected.contextModification) {
			throw new Error(
				`Hook output assertion failed for 'contextModification':\n` +
					`  Expected: "${expected.contextModification}"\n` +
					`  Received: "${actual.contextModification}"\n` +
					`  Full output: ${JSON.stringify(actual, null, 2)}`,
			)
		}
	}

	if (expected.errorMessage !== undefined) {
		if (actual.errorMessage !== expected.errorMessage) {
			throw new Error(
				`Hook output assertion failed for 'errorMessage':\n` +
					`  Expected: "${expected.errorMessage}"\n` +
					`  Received: "${actual.errorMessage}"\n` +
					`  Full output: ${JSON.stringify(actual, null, 2)}`,
			)
		}
	}
}

/**
 * Type guard to check if a value is serializable (can be cloned).
 * Prevents errors from attempting to clone non-serializable objects.
 */
function isSerializable(value: any): boolean {
	if (value === null || value === undefined) {
		return true
	}

	const type = typeof value
	if (type === "string" || type === "number" || type === "boolean") {
		return true
	}

	if (type === "object") {
		// Check for non-serializable types
		if (value instanceof Function || value instanceof RegExp || value instanceof Error) {
			return false
		}

		// Check if it's an array or plain object
		if (Array.isArray(value)) {
			return value.every(isSerializable)
		}

		// For objects, check all values
		return Object.values(value).every(isSerializable)
	}

	return false
}

/**
 * Mock implementation of HookRunner for fast integration tests.
 * Tracks calls and returns predefined responses without spawning processes.
 *
 * @example
 * const mockRunner = new MockHookRunner("PreToolUse")
 * mockRunner.setResponse({ cancel: false })
 *
 * const result = await mockRunner.run(input)
 * mockRunner.assertCalled(1)
 * mockRunner.assertCalledWith({ preToolUse: { toolName: "write_to_file" } })
 */
export class MockHookRunner<Name extends HookName> {
	private response: HookOutput = {
		cancel: false,
		contextModification: "",
		errorMessage: "",
	}
	public executionLog: Array<{ input: NamedHookInput<Name>; timestamp: number }> = []
	public readonly hookName: Name

	constructor(hookName: Name) {
		this.hookName = hookName
	}

	/**
	 * Set the response this mock should return.
	 *
	 * @param output The HookOutput to return on execution
	 */
	setResponse(output: Partial<HookOutput>): void {
		this.response = {
			cancel: output.cancel ?? false,
			contextModification: output.contextModification ?? "",
			errorMessage: output.errorMessage ?? "",
		}
	}

	/**
	 * Mock run method that records calls and returns preset response.
	 * Does not use the actual HookRunner execution mechanism.
	 */
	async run(params: NamedHookInput<Name>): Promise<HookOutput> {
		// Validate params are serializable
		if (!isSerializable(params)) {
			throw new Error(
				`MockHookRunner: Cannot clone non-serializable input. ` +
					`Ensure all input values are primitive types, arrays, or plain objects.`,
			)
		}

		// Use structuredClone for deep copy (Node 17+)
		// Falls back to JSON stringify/parse for older Node versions
		let clonedInput: NamedHookInput<Name>
		try {
			clonedInput = structuredClone(params)
		} catch {
			// Fallback for older Node versions
			clonedInput = JSON.parse(JSON.stringify(params))
		}

		this.executionLog.push({
			input: clonedInput,
			timestamp: Date.now(),
		})

		// Simulate async execution
		await new Promise((resolve) => setTimeout(resolve, 1))

		return this.response
	}

	/**
	 * Assert this hook was called a specific number of times.
	 *
	 * @param times Expected number of calls
	 */
	assertCalled(times: number): void {
		if (this.executionLog.length !== times) {
			throw new Error(
				`MockHookRunner call count assertion failed:\n` +
					`  Expected: ${times} calls\n` +
					`  Received: ${this.executionLog.length} calls\n` +
					`  Execution log:\n${JSON.stringify(this.executionLog, null, 2)}`,
			)
		}
	}

	/**
	 * Assert this hook was called with matching input.
	 * Performs partial match on the input object using deep equality.
	 * Property ordering does not affect equality checks.
	 * Uses should.js's eql() for robust deep equality comparison.
	 *
	 * @param matcher Partial input to match against
	 */
	assertCalledWith(matcher: Partial<NamedHookInput<Name>>): void {
		const matchingCalls = this.executionLog.filter((log) => {
			return Object.keys(matcher).every((key) => {
				const matcherValue = (matcher as any)[key]
				const logValue = (log.input as any)[key]
				// Use should.js's eql() for deep equality (handles property ordering)
				try {
					should(logValue).eql(matcherValue)
					return true
				} catch {
					return false
				}
			})
		})

		if (matchingCalls.length === 0) {
			throw new Error(
				`MockHookRunner input assertion failed - no calls matched the expected input:\n` +
					`  Expected input (partial): ${JSON.stringify(matcher, null, 2)}\n` +
					`  Actual calls: ${JSON.stringify(this.executionLog, null, 2)}`,
			)
		}
	}

	/**
	 * Reset all recorded calls and responses.
	 */
	reset(): void {
		this.executionLog = []
		this.response = {
			cancel: false,
			contextModification: "",
			errorMessage: "",
		}
	}
}

/**
 * Copies a fixture to the test environment.
 *
 * @param fixtureName Path to fixture relative to fixtures directory (e.g., "hooks/pretooluse/success")
 * @param destDir Destination directory (typically tempDir from test environment)
 *
 * @example
 * await loadFixture("hooks/pretooluse/success", tempDir)
 * // Hook is now available at tempDir/.clinerules/hooks/PreToolUse
 */
export async function loadFixture(fixtureName: string, destDir: string): Promise<void> {
	const fixturesDir = path.join(__dirname, "fixtures")
	const sourcePath = path.join(fixturesDir, fixtureName)
	const destHooksDir = await createHooksDirectory(destDir)

	// Copy all files from the fixture directory to the destination
	const files = await fs.readdir(sourcePath)
	for (const file of files) {
		const sourceFile = path.join(sourcePath, file)
		const destFile = path.join(destHooksDir, file)
		await fs.copyFile(sourceFile, destFile)

		// Set executable permission (not needed on Windows)
		if (process.platform !== "win32") {
			const stats = await fs.stat(sourceFile)
			await fs.chmod(destFile, stats.mode)
		}
	}
}
