import readline from "node:readline"
import { execa } from "execa"
import type { RuntimeStreamTranslator } from "./stream-translator"
import { RuntimeShimError, type RuntimeShimExecutionOptions, type RuntimeShimFailureType, type RuntimeShimLauncher } from "./shim-types"

const DEFAULT_TIMEOUT_MS = 600000
const DEFAULT_MAX_BUFFER_BYTES = 20_000_000

const getFailureType = (error: unknown, exitCode: number | null): RuntimeShimFailureType => {
	if (exitCode !== null && exitCode !== 0) {
		return "non_zero_exit"
	}

	if (error instanceof Error && error.message.includes("ENOENT")) {
		return "spawn_failed"
	}

	return "process_error"
}

const buildNormalizedError = (options: {
	command: string
	error: unknown
	exitCode: number | null
	stderrOutput: string
}): RuntimeShimError => {
	const { command, error, exitCode, stderrOutput } = options
	const failureType = getFailureType(error, exitCode)
	const errorMessage = error instanceof Error ? error.message : String(error)
	const stderrSuffix = stderrOutput.trim() ? ` ${stderrOutput.trim()}` : ""

	return new RuntimeShimError({
		command,
		failureType,
		exitCode,
		stderrOutput,
		message: `${command} failed (${failureType}).${stderrSuffix || ` ${errorMessage}`}`.trim(),
		cause: error,
	})
}

export class RuntimeShimWrapper {
	constructor(private readonly launch: RuntimeShimLauncher = execa as unknown as RuntimeShimLauncher) {}

	async *execute<TChunk>(
		options: RuntimeShimExecutionOptions,
		translator: RuntimeStreamTranslator<TChunk>,
	): AsyncGenerator<TChunk> {
		const child = this.launch(options.command, options.args, {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: options.env,
			cwd: options.cwd,
			maxBuffer: options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
			timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		})

		if (options.stdinPayload !== undefined) {
			child.stdin.write(options.stdinPayload)
		}
		child.stdin.end()

		const rl = readline.createInterface({ input: child.stdout })
		let stderrOutput = ""
		let exitCode: number | null = null
		let processError: Error | null = null

		child.stderr.on("data", (chunk) => {
			stderrOutput += chunk.toString()
		})

		child.on("close", (code) => {
			exitCode = code
		})

		child.on("error", (error) => {
			processError = error
		})

		try {
			for await (const line of rl) {
				if (processError) {
					throw processError
				}

				if (!line.trim()) {
					continue
				}

				yield* translator.translateStdout(line)
			}

			yield* translator.flush()

			const result = await child
			if (result.exitCode !== null && result.exitCode !== 0) {
				throw new Error(`Process exited with code ${result.exitCode}`)
			}
		} catch (error) {
			throw buildNormalizedError({
				command: options.command,
				error,
				exitCode,
				stderrOutput,
			})
		} finally {
			rl.close()
			if (!child.killed) {
				child.kill()
			}
		}
	}
}
