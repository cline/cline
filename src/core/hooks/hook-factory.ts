import { spawn } from "node:child_process"
import fs from "fs/promises"
import path from "path"
import { version as clineVersion } from "../../../package.json"
import { getDistinctId } from "../../services/logging/distinctId" // TODO: is this usage appropriate for users not logged in?
import { HookInput, HookOutput, PostToolUseData, PreToolUseData } from "../../shared/proto/cline/hooks"
import { getWorkspaceHooksDirs } from "../storage/disk"
import { StateManager } from "../storage/StateManager"

export interface Hooks {
	PreToolUse: {
		preToolUse: PreToolUseData
	}
	PostToolUse: {
		postToolUse: PostToolUseData
	}
}

// The names of all supported hooks. Hooks[N] is the type of data the hook takes as input.
type HookName = keyof Hooks

/**
 * The hook input parameters for a named hook. These are the parameters the caller must
 * provide--the other common parameters like clineVersion and userId are handled by the
 * hook system.
 */
export type NamedHookInput<Name extends HookName> = {
	taskId: string
} & Hooks[Name]

// We look up HookRunner.exec via symbol so that the combined hook runner can call
// exec on its sub-runners without completing a new set of parameters for each one.
// See CombinedHookRunner[exec]
const exec = Symbol()

/**
 * Runs a hook.
 */
export abstract class HookRunner<Name extends HookName> {
	constructor(public readonly hookName: Name) {}

	// TODO: Give this a result indicating HookOutput.
	// TODO: Is this design right? If we want to collect results in this object, we should not have a 'run' method hanging out there that you can call multiple times.
	async run(params: NamedHookInput<Name>): Promise<HookOutput> {
		const input = HookInput.create(await this.completeParams(params))
		return this[exec](input)
	}

	abstract [exec](params: HookInput): Promise<HookOutput>

	// Completes the hook input parameters by adding the common hook parameters to the
	// hook-specific parameters provided by the caller.
	protected async completeParams(params: NamedHookInput<Name>): Promise<HookInput> {
		const workspaceRoots =
			StateManager.get()
				.getGlobalStateKey("workspaceRoots")
				?.map((root) => root.path) || []
		return {
			clineVersion,
			hookName: this.hookName,
			timestamp: Date.now().toString(),
			workspaceRoots,
			userId: getDistinctId(),
			...params,
		}
	}
}

// The NoOpRunner is used when there's no hook to run. It immediately succeeds.
class NoOpRunner<Name extends HookName> extends HookRunner<Name> {
	constructor(hookName: Name) {
		super(hookName)
	}

	override async [exec](_: HookInput): Promise<HookOutput> {
		return HookOutput.create({
			shouldContinue: true,
		})
	}
}

// Actually runs a hook by executing a script and passing JSON into it.
class StdioHookRunner<Name extends HookName> extends HookRunner<Name> {
	constructor(
		hookName: Name,
		public readonly scriptPath: string,
	) {
		super(hookName)
	}

	override async [exec](input: HookInput): Promise<HookOutput> {
		return new Promise((resolve, reject) => {
			// Serialize input to JSON
			const inputJson = JSON.stringify(HookInput.toJSON(input))

			// Spawn the hook process
			const child = spawn(this.scriptPath, [], {
				stdio: ["pipe", "pipe", "pipe"],
				shell: process.platform === "win32",
			})

			let stdout = ""
			let stderr = ""

			// Collect stdout
			child.stdout?.on("data", (data) => {
				stdout += data.toString()
			})

			// Collect stderr
			child.stderr?.on("data", (data) => {
				stderr += data.toString()
			})

			// Handle process completion
			child.on("close", (code) => {
				if (code !== 0) {
					reject(new Error(`Hook ${this.hookName} exited with code ${code}. stderr: ${stderr}`))
					return
				}

				try {
					// Parse and validate output
					const outputData = JSON.parse(stdout)
					const output = HookOutput.fromJSON(outputData)
					resolve(output)
				} catch (error) {
					reject(new Error(`Failed to parse hook output: ${error}. stdout: ${stdout}`))
				}
			})

			// Handle process errors
			child.on("error", (error) => {
				reject(new Error(`Failed to execute hook ${this.hookName}: ${error.message}`))
			})

			// Send input to the process
			child.stdin?.write(inputJson)
			child.stdin?.end()
		})
	}
}

// CombinedHookRunner runs multiple hooks and combines the results. Used when a workspace
// has multiple roots contributing the same hook.
class CombinedHookRunner<Name extends HookName> extends HookRunner<Name> {
	constructor(
		hookName: Name,
		private readonly runners: readonly HookRunner<Name>[],
	) {
		super(hookName)
	}

	override async [exec](input: HookInput): Promise<HookOutput> {
		// Run all hooks in parallel
		const results = await Promise.all(this.runners.map((runner) => runner[exec](input)))

		// Merge results:
		// - If any hook indicates execution should stop, then stop
		// - Combine context contributions from all hooks
		// - Collect any error messages

		const shouldContinue = results.every((result) => result.shouldContinue)
		const contextModification = results
			.map((result) => result.contextModification?.trim())
			.filter((mod) => mod)
			.join("\n\n")
		const errorMessage = results
			.map((result) => result.errorMessage?.trim())
			.filter((msg) => msg)
			.join("\n")

		return HookOutput.create({
			shouldContinue,
			contextModification,
			errorMessage,
		})
	}
}

export class HookFactory {
	async create<Name extends HookName>(hookName: Name): Promise<HookRunner<Name>> {
		const scripts = await HookFactory.findHookScripts(hookName)
		const runners = scripts.map((script) => new StdioHookRunner(hookName, script))
		if (runners.length === 0) {
			return new NoOpRunner(hookName)
		}
		return runners.length === 1 ? runners[0] : new CombinedHookRunner(hookName, runners)
	}

	/**
	 * @returns A list of paths to scripts for the given hook name.
	 */
	private static async findHookScripts(hookName: HookName): Promise<string[]> {
		const hookScripts = []
		for (const hooksDir of await getWorkspaceHooksDirs()) {
			hookScripts.push(HookFactory.findHookInHooksDir(hookName, hooksDir))
		}
		const isDefined = (scriptPath: string | undefined): scriptPath is string => Boolean(scriptPath)
		return (await Promise.all(hookScripts)).filter(isDefined)
	}

	/**
	 * Finds the path to a hook in a .clinerules hooks directory.
	 *
	 * @param hookName the name of the hook to search for, for example 'PreToolUse'
	 * @param hooksDir the .clinerules directory path to search
	 * @returns the path to the hook to execute, or undefined if none
	 */
	private static async findHookInHooksDir(hookName: HookName, hooksDir: string): Promise<string | undefined> {
		if (process.platform === "win32") {
			// Windows doesn't have an executable bit, instead files are handed off
			// to a set of interpreters described in PATHEXT and the Windows registry.
			// PATHEXT is a ;-delimited list of extensions like .EXE;.COM;.CMD;... etc.
			const pathExts = process.env.PATHEXT?.split(";") || []
			for (const pathExt of pathExts) {
				const candidate = path.join(hooksDir, hookName + pathExt)
				try {
					if ((await fs.stat(candidate)).isFile()) {
						return candidate
					}
				} catch {
					// Typically, the hook file does not exist. Keep searching.
					// TODO: Filter expected exceptions here and propagate ones indicating failure.
				}
			}
			return undefined
		}

		// Linux and macOS
		const candidate = path.join(hooksDir, hookName)
		try {
			const [stat, _] = await Promise.all([fs.stat(candidate), fs.access(candidate, fs.constants.X_OK)])
			return stat.isFile() ? candidate : undefined
		} catch {
			// Typically ENOENT because the hook file does not exist;
			// fs.access will throw if the file exists but is not executable.
			// In either case, this means there's no hook to run here.
			// TODO: Filter expected exceptions here and propagate ones indicating failure.
			return undefined
		}
	}
}
