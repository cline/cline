import type { Readable } from "node:stream"

export type RuntimeShimFailureType = "spawn_failed" | "process_error" | "non_zero_exit"

export class RuntimeShimError extends Error {
	readonly command: string
	readonly failureType: RuntimeShimFailureType
	readonly exitCode: number | null
	readonly stderrOutput: string

	constructor(options: {
		command: string
		failureType: RuntimeShimFailureType
		message: string
		exitCode?: number | null
		stderrOutput?: string
		cause?: unknown
	}) {
		super(options.message)
		this.name = "RuntimeShimError"
		this.command = options.command
		this.failureType = options.failureType
		this.exitCode = options.exitCode ?? null
		this.stderrOutput = options.stderrOutput ?? ""
		this.cause = options.cause
	}
}

export interface RuntimeShimExecutionOptions {
	command: string
	args: string[]
	cwd: string
	env?: NodeJS.ProcessEnv
	stdinPayload?: string
	timeoutMs?: number
	maxBufferBytes?: number
}

export interface RuntimeShimLaunchResult extends PromiseLike<{ exitCode: number | null }> {
	stdin: {
		write(chunk: string): void
		end(): void
	}
	stdout: Readable
	stderr: Readable
	killed: boolean
	kill(signal?: number | NodeJS.Signals): void
	on(event: "close", listener: (code: number | null) => void): this
	on(event: "error", listener: (error: Error) => void): this
}

export type RuntimeShimLauncher = (
	command: string,
	args: string[],
	options: {
		stdin: "pipe"
		stdout: "pipe"
		stderr: "pipe"
		env?: NodeJS.ProcessEnv
		cwd: string
		maxBuffer?: number
		timeout?: number
	},
) => RuntimeShimLaunchResult
