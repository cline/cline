import { TerminalOutputFailureReason, telemetryService } from "@services/telemetry"
import { EventEmitter } from "events"
import * as vscode from "vscode"
import { stripAnsi } from "@/hosts/vscode/terminal/ansiUtils"
import { getLatestTerminalOutput } from "@/hosts/vscode/terminal/get-latest-output"
import {
	EXIT_CODE_EVENT_TIMEOUT_MS,
	isCompilingOutput,
	MARKERLESS_FIRST_DATA_TIMEOUT,
	MARKERLESS_IDLE_TIMEOUT,
	MARKERLESS_MAX_QUIET_TIME,
	MAX_FULL_OUTPUT_SIZE,
	MAX_UNRETRIEVED_LINES,
	PROCESS_HOT_TIMEOUT_COMPILING,
	PROCESS_HOT_TIMEOUT_NORMAL,
	TRUNCATE_KEEP_LINES,
} from "@/integrations/terminal/constants"
import type { ITerminalProcess, TerminalCompletionDetails, TerminalProcessEvents } from "@/integrations/terminal/types"
import type { MarkerlessCompletionCause } from "@/services/telemetry/TelemetryService"
import { Logger } from "@/shared/services/Logger"
import { Osc633EventType, Osc633Parser } from "./osc633Parser"
import { classifyShellPrompt, getLastLine } from "./shellPromptHeuristics"

/** Outcome of racing one stream read against the markerless-completion timers. */
type StreamReadOutcome = { kind: "data"; data: string } | { kind: "streamEnd" } | { kind: "idle" } | { kind: "terminalClosed" }

/**
 * VscodeTerminalProcess - Manages command execution in VSCode's integrated terminal.
 *
 * This class handles command execution using VSCode's shell integration API.
 * It processes VSCode-specific escape sequences and streams output through events.
 *
 * Implements ITerminalProcess interface for polymorphic usage with CommandExecutor.
 *
 * Events:
 * - 'line': Emitted for each line of output
 * - 'completed': Emitted when the process completes
 * - 'continue': Emitted when continue() is called
 * - 'error': Emitted on process errors
 * - 'no_shell_integration': Emitted when shell integration is not available
 */
export class VscodeTerminalProcess extends EventEmitter<TerminalProcessEvents> implements ITerminalProcess {
	waitForShellIntegration = true
	private isListening = true
	private buffer = ""
	private fullOutput = ""
	private lastRetrievedIndex = 0
	isHot = false
	private hotTimer: NodeJS.Timeout | null = null
	private exitCode: number | null | undefined = undefined
	private signal: NodeJS.Signals | null = null
	private terminalClosedMidCommand = false

	async run(terminal: vscode.Terminal, command: string) {
		this.exitCode = undefined
		this.signal = null

		// The pty may already be dead (exitStatus is set when the shell process
		// terminates). executeCommand()/sendText() on a dead terminal never
		// produces completion events, so fail fast instead of hanging.
		if (terminal.exitStatus !== undefined) {
			this.exitCode = terminal.exitStatus.code
			this.emit("error", new Error("The terminal's shell process has exited; the command was not run."))
			return
		}

		// When command does not produce any output, we can assume the shell integration API failed and as a fallback return the current terminal contents
		const returnCurrentTerminalContents = async () => {
			try {
				const terminalSnapshot = await getLatestTerminalOutput()
				if (terminalSnapshot && terminalSnapshot.trim()) {
					const fallbackMessage = `The command's output could not be captured through shell integration. Here is the current terminal's content, which may include the command's output:\n\n${terminalSnapshot}`
					this.emit("line", fallbackMessage)
				}
			} catch (error) {
				Logger.error("Error capturing terminal output:", error)
			}
		}

		if (terminal.shellIntegration && terminal.shellIntegration.executeCommand) {
			// Shell integration is available (VS Code 1.93+). The read() stream yields
			// raw terminal data including OSC 633 escape sequences. We use a
			// chunk-boundary-safe parser to strip those sequences and extract the
			// CommandExecuted (C) marker that delimits the start of command output.
			// Text after C is the command's actual output; everything before (prompt,
			// command echo) is naturally excluded by the marker.
			//
			// NOTE: The CommandFinished (D) marker and its exit code do NOT appear in
			// the read() stream. VS Code's shell integration addon consumes the D
			// sequence synchronously and fires onDidEndTerminalShellExecution (with the
			// exit code) before the debounced data event reaches the stream. We listen
			// to that event to capture the exit code; the D-marker parsing in the parser
			// is kept only to delimit command output segments (see below), not as an
			// exit-code source.
			const execution = terminal.shellIntegration.executeCommand(command)
			const stream = execution.read()
			const parser = new Osc633Parser()
			let didSeeCommandExecuted = false
			let inCommandOutput = false
			let preCommandBuffer = "" // text before C; emitted as fallback if C never arrives
			let didEmitEmptyLine = false

			// Listen for the shell execution end event to capture the exit code.
			// This is the reliable source — the D marker is stripped from the stream.
			// The event fires asynchronously AFTER the read() stream completes (VS Code
			// calls flush().then(() => fire(endEvent))), so we must await it rather
			// than checking synchronously.
			//
			// onDidEndTerminalShellExecution has been stable API since VS Code 1.93,
			// below our minimum supported version (see package.json engines.vscode), so it is
			// always available here. It fires for every execution on a shell-integrated
			// terminal, but only when shell integration actually reports command
			// completion — a command typed into a remote shell over ssh, for example,
			// has shell integration present but may never trigger this event for that
			// execution. That case is bounded by the exit-code race below, not by
			// feature-detecting the event itself.
			const resolveExitCode = Promise.withResolvers<number | undefined>()
			const endEventDisposable = vscode.window.onDidEndTerminalShellExecution((e) => {
				if (e.terminal === terminal && e.execution === execution) {
					resolveExitCode.resolve(e.exitCode)
				}
			})

			// Track terminal closure so a dying pty can't leave the read loop
			// blocked forever — the read() stream does not necessarily end when
			// the terminal is disposed mid-command.
			let terminalClosed = false
			let resolveTerminalClosed!: () => void
			const terminalClosedPromise = new Promise<void>((resolve) => {
				resolveTerminalClosed = resolve
			})
			const closeDisposable = vscode.window.onDidCloseTerminal((closedTerminal) => {
				if (closedTerminal === terminal) {
					terminalClosed = true
					resolveTerminalClosed()
				}
			})

			// The stream is pulled manually (rather than with for-await) so each
			// read can be raced against the markerless-completion timers and
			// terminal closure. When a timer wins the race, the outstanding read
			// is kept and reused on the next iteration — iterator.next() must
			// not be called again while a previous read is still pending.
			const iterator = stream[Symbol.asyncIterator]()
			let pendingRead: Promise<IteratorResult<string>> | undefined
			const readNext = async (idleTimeoutMs: number | undefined): Promise<StreamReadOutcome> => {
				pendingRead ??= iterator.next()
				let idleTimer: NodeJS.Timeout | undefined
				const racers: Promise<StreamReadOutcome>[] = [
					pendingRead.then(
						(result): StreamReadOutcome =>
							result.done ? { kind: "streamEnd" } : { kind: "data", data: result.value },
					),
					terminalClosedPromise.then((): StreamReadOutcome => ({ kind: "terminalClosed" })),
				]
				if (idleTimeoutMs !== undefined) {
					racers.push(
						new Promise<StreamReadOutcome>((resolve) => {
							idleTimer = setTimeout(() => resolve({ kind: "idle" }), idleTimeoutMs)
						}),
					)
				}
				try {
					const outcome = await Promise.race(racers)
					if (outcome.kind === "data" || outcome.kind === "streamEnd") {
						pendingRead = undefined
					}
					return outcome
				} finally {
					if (idleTimer) {
						clearTimeout(idleTimer)
					}
				}
			}

			// Whether the loop completed via the markerless idle fallback: the
			// CommandExecuted (C) marker never arrived, so the stream will never
			// end on its own. This happens when commands are typed into a shell
			// that VS Code's shell integration script isn't running in — most
			// commonly an ssh session started from this terminal, where the
			// remote shell emits no OSC 633 sequences.
			let completedWithoutMarkers = false
			let markerlessCause: MarkerlessCompletionCause | undefined
			let markerlessQuietMs = 0
			let receivedAnyData = false

			while (true) {
				// Until the C marker arrives, shell integration may not actually
				// be working, so bound each read with an idle timeout. Once C is
				// seen the markers are trusted to delimit the command — however
				// long and quiet it runs — and only terminal closure can
				// interrupt the read.
				const idleTimeoutMs = didSeeCommandExecuted
					? undefined
					: receivedAnyData
						? MARKERLESS_IDLE_TIMEOUT
						: MARKERLESS_FIRST_DATA_TIMEOUT
				const outcome = await readNext(idleTimeoutMs)

				if (outcome.kind === "streamEnd") {
					break
				}
				if (outcome.kind === "terminalClosed") {
					Logger.warn("[TerminalProcess] Terminal closed while a command was running")
					break
				}
				if (outcome.kind === "idle") {
					markerlessQuietMs += idleTimeoutMs ?? 0
					// Complete when the terminal has gone quiet on something that
					// looks like a shell prompt, or has been quiet for so long
					// that waiting further would just stall the task. A "strong"
					// prompt match (bash $, root #, PowerShell/CMD path, Python
					// REPL, starship) is trusted after a single idle period. A
					// "weak" match (bare > or %) is also produced by a still-running
					// command — a hung ssh session's continuation prompt, an
					// HTML/XML tag, a progress meter — so it's only trusted once
					// the full quiet timeout has elapsed, same as no match at all.
					const promptCandidate = getLastLine(stripAnsi(preCommandBuffer))
					const promptStrength = classifyShellPrompt(promptCandidate)
					const quietTimeoutReached = markerlessQuietMs >= MARKERLESS_MAX_QUIET_TIME
					if (promptStrength === "strong" || quietTimeoutReached) {
						completedWithoutMarkers = true
						markerlessCause =
							promptStrength === "strong" ? "prompt_quiet" : receivedAnyData ? "max_quiet_time" : "no_data"
						break
					}
					continue
				}

				receivedAnyData = true
				markerlessQuietMs = 0
				let data = outcome.data

				// Ctrl+C detection: if user presses Ctrl+C, treat as command terminated
				if (data.includes("^C") || data.includes("\u0003")) {
					if (this.hotTimer) {
						clearTimeout(this.hotTimer)
					}
					this.isHot = false
					break
				}

				const { segments } = parser.parse(data)

				// Walk segments in order, gating text on the [C, D) marker window.
				// Text before C (prompt/echo) is buffered separately as a fallback;
				// if C never arrives (e.g. ssh/nested shells where SI is present
				// but not emitting markers), the buffered text is emitted at the end.
				let chunkOutput = ""
				for (const seg of segments) {
					if (seg.kind === "event") {
						if (seg.event.type === Osc633EventType.CommandExecuted) {
							didSeeCommandExecuted = true
							inCommandOutput = true
							preCommandBuffer = "" // discard pre-C text (was prompt/echo)
						} else if (seg.event.type === Osc633EventType.CommandFinished) {
							inCommandOutput = false
							if (seg.event.exitCode !== undefined) {
								this.exitCode = seg.event.exitCode
							}
						}
					} else {
						// Text segment
						if (inCommandOutput) {
							chunkOutput += seg.text
						} else if (!didSeeCommandExecuted) {
							// Pre-C text; buffer for the no-markers fallback.
							preCommandBuffer += seg.text
							// A markerless session (e.g. ssh) can stream indefinitely;
							// cap the buffer to prevent memory exhaustion.
							if (preCommandBuffer.length > MAX_FULL_OUTPUT_SIZE) {
								preCommandBuffer = preCommandBuffer.slice(-MAX_FULL_OUTPUT_SIZE / 2)
							}
						}
						// Post-D text (next prompt) is discarded.
					}
				}

				// Strip remaining ANSI escape sequences (colors, cursor moves, etc.)
				data = stripAnsi(chunkOutput)

				if (!data) {
					continue
				}

				// 2. Set isHot depending on the command
				// Set to hot to stall API requests until terminal is cool again
				this.isHot = true
				if (this.hotTimer) {
					clearTimeout(this.hotTimer)
				}
				// these markers indicate the command is some kind of local dev server recompiling the app, which we want to wait for output of before sending request to cline
				const isCompiling = isCompilingOutput(data)
				this.hotTimer = setTimeout(
					() => {
						this.isHot = false
					},
					isCompiling ? PROCESS_HOT_TIMEOUT_COMPILING : PROCESS_HOT_TIMEOUT_NORMAL,
				)

				// For non-immediately returning commands we want to show loading spinner right away but this wouldn't happen until it emits a line break, so as soon as we get any output we emit "" to let webview know to show spinner
				// This is only done for the sake of unblocking the UI, in case there may be some time before the command emits a full line
				if (!didEmitEmptyLine && !this.fullOutput && data) {
					this.emit("line", "") // empty line to indicate start of command output stream
					didEmitEmptyLine = true
				}

				this.fullOutput += data

				// Cap fullOutput at MAX_FULL_OUTPUT_SIZE to prevent memory exhaustion
				if (this.fullOutput.length > MAX_FULL_OUTPUT_SIZE) {
					// Keep last half of max size
					this.fullOutput = this.fullOutput.slice(-MAX_FULL_OUTPUT_SIZE / 2)
					// Reset lastRetrievedIndex since we truncated the beginning
					this.lastRetrievedIndex = 0
				}

				if (this.isListening) {
					this.emitIfEol(data)
					this.lastRetrievedIndex = this.fullOutput.length - this.buffer.length
				}
			}

			closeDisposable.dispose()
			// Release the stream iterator. On the markerless/terminal-closed
			// paths a read is still pending; return() lets a well-behaved
			// iterator clean up instead of holding the stream open. Not
			// awaited: a generator blocked on a pending await settles return()
			// only when that await settles, which may be never.
			try {
				iterator.return?.()?.catch?.(() => {})
			} catch {
				// The iterator does not support early termination.
			}
			this.emitRemainingBufferIfListening()

			// Await the exit code from onDidEndTerminalShellExecution.
			// The event fires asynchronously AFTER the read() stream completes
			// (VS Code calls flush().then(() => fire(endEvent))), so we must
			// await it here. Race with a timeout in case the event never fires —
			// this happens when shell integration is attached but not reporting
			// completion for this execution (e.g. commands typed into a remote
			// ssh session), not because the API is unavailable.
			let exitCodeEventTimedOut = false
			const eventExitCode = await Promise.race([
				resolveExitCode.promise,
				new Promise<undefined>((resolve) => {
					setTimeout(() => {
						exitCodeEventTimedOut = true
						resolve(undefined)
					}, EXIT_CODE_EVENT_TIMEOUT_MS)
				}),
			])
			endEventDisposable.dispose()

			if (exitCodeEventTimedOut) {
				// A lost exit code silently reports the command as successful to the
				// agent (no exitCode means no CommandExitError below) — worth a log
				// since it's otherwise invisible.
				Logger.warn(
					`[TerminalProcess] onDidEndTerminalShellExecution did not fire within ${EXIT_CODE_EVENT_TIMEOUT_MS}ms; exit code unknown`,
				)
			}

			// Prefer the event-captured exit code (reliable source — the D marker
			// is stripped from the read() stream by VS Code). Fall back to the
			// parser-extracted exit code (from the D marker) if the event didn't
			// fire in time.
			if (eventExitCode !== undefined) {
				this.exitCode = eventExitCode
			}

			// If we never saw the CommandExecuted (C) marker (e.g. ssh/nested
			// shells where shell integration is present but not emitting markers),
			// emit the buffered pre-C text as a fallback so the user still gets
			// output.
			if (!didSeeCommandExecuted && preCommandBuffer.trim()) {
				const fallbackData = stripAnsi(preCommandBuffer)
				if (fallbackData) {
					this.fullOutput += fallbackData
					if (this.isListening) {
						this.emitIfEol(fallbackData)
						this.emitRemainingBufferIfListening()
					}
				}
			}

			// the command process is finished, let's check the output to see if we need to use the terminal capture fallback
			if (!this.fullOutput.trim()) {
				// No output captured via shell integration, trying fallback
				telemetryService.captureTerminalOutputFailure(
					terminalClosed ? TerminalOutputFailureReason.TERMINAL_CLOSED : TerminalOutputFailureReason.TIMEOUT,
					"vscode",
				)
				// The clipboard fallback reads the *active* terminal, so it is
				// meaningless once this terminal has closed.
				// (Undefined detail values are omitted from the event; markerlessCause
				// is only set when the markerless fallback completed the command.)
				const fallbackDetails = {
					terminalExecutionMode: "vscodeTerminal" as const,
					markerlessCause,
					terminalClosed: terminalClosed || undefined,
				}
				if (!terminalClosed) {
					await returnCurrentTerminalContents()
					// Check if fallback worked
					const terminalSnapshot = await getLatestTerminalOutput()
					if (terminalSnapshot && terminalSnapshot.trim()) {
						telemetryService.captureTerminalExecution(true, "vscode", "clipboard", fallbackDetails)
					} else {
						telemetryService.captureTerminalExecution(false, "vscode", "none", fallbackDetails)
					}
				} else {
					telemetryService.captureTerminalExecution(false, "vscode", "none", fallbackDetails)
				}
			} else {
				// Output was captured, but distinguish *how* it was completed: real
				// OSC 633 C/D markers ("shell_integration") vs the idle/prompt
				// heuristic fallback ("markerless_heuristic") when markers never
				// arrived. Folding the latter into "shell_integration" successes
				// would inflate the metric this PR's fixes are evaluated against.
				// A terminal closed mid-command is not a success even though some
				// output was captured — the command was interrupted.
				telemetryService.captureTerminalExecution(
					!terminalClosed,
					"vscode",
					completedWithoutMarkers ? "markerless_heuristic" : "shell_integration",
					{
						exitCode: this.exitCode,
						terminalExecutionMode: "vscodeTerminal",
						markerlessCause,
						terminalClosed: terminalClosed || undefined,
					},
				)
			}

			// for now we don't want this delaying requests since we don't send diagnostics automatically anymore (previous: "even though the command is finished, we still want to consider it 'hot' in case so that api request stalls to let diagnostics catch up")
			// to explain this further, before we would send workspace diagnostics automatically with each request, but now we only send new diagnostics after file edits, so there's no need to wait for a bit after commands run to let diagnostics catch up
			if (this.hotTimer) {
				clearTimeout(this.hotTimer)
			}
			this.isHot = false

			if (terminalClosed) {
				this.terminalClosedMidCommand = true
				this.emit("line", "[The terminal closed while the command was running; output may be incomplete.]")
			} else if (completedWithoutMarkers) {
				this.emit(
					"line",
					"[Shell integration did not report command completion (this happens e.g. inside ssh or nested shells); output was captured with a timing heuristic, may be incomplete or include the shell prompt, and the command may still be running.]",
				)
			}

			this.emit("completed", this.getCompletionDetails())
			this.emit("continue")
			// A terminal whose shell isn't emitting completion markers (e.g. it
			// is inside an ssh session) must not be reused for later commands:
			// this event makes the manager evict it from the reuse pool, exactly
			// like a terminal that never had shell integration.
			if (completedWithoutMarkers) {
				this.emit("no_shell_integration")
			}
		} else {
			// no shell integration detected, we'll fallback to running the command and capturing the terminal's output after some time
			telemetryService.captureTerminalOutputFailure(TerminalOutputFailureReason.NO_SHELL_INTEGRATION, "vscode")
			terminal.sendText(command, true)

			// wait 3 seconds for the command to run
			await new Promise((resolve) => setTimeout(resolve, 3000))

			// For terminals without shell integration, also try to capture terminal content
			await returnCurrentTerminalContents()
			// Check if clipboard fallback worked
			const terminalSnapshot = await getLatestTerminalOutput()
			if (terminalSnapshot && terminalSnapshot.trim()) {
				telemetryService.captureTerminalExecution(true, "vscode", "clipboard", {
					terminalExecutionMode: "vscodeTerminal",
				})
			} else {
				telemetryService.captureTerminalExecution(false, "vscode", "none", {
					terminalExecutionMode: "vscodeTerminal",
				})
			}
			// For terminals without shell integration, we can't know when the command completes
			// So we'll just emit the continue event after a delay
			this.emit("completed", this.getCompletionDetails())
			this.emit("continue")
			this.emit("no_shell_integration")
		}
	}

	// Inspired by https://github.com/sindresorhus/execa/blob/main/lib/transform/split.js
	private emitIfEol(chunk: string) {
		this.buffer += chunk
		let lineEndIndex: number
		while ((lineEndIndex = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, lineEndIndex).trimEnd() // removes trailing \r
			// Remove \r if present (for Windows-style line endings)
			// if (line.endsWith("\r")) {
			// 	line = line.slice(0, -1)
			// }
			this.emit("line", line)
			this.buffer = this.buffer.slice(lineEndIndex + 1)
		}
	}

	private emitRemainingBufferIfListening() {
		if (this.buffer && this.isListening) {
			const remainingBuffer = this.removeLastLineArtifacts(this.buffer)
			if (remainingBuffer) {
				this.emit("line", remainingBuffer)
			}
			this.buffer = ""
			this.lastRetrievedIndex = this.fullOutput.length
		}
	}

	continue() {
		this.emitRemainingBufferIfListening()
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	/**
	 * Get output that hasn't been retrieved yet.
	 * Truncates if output is too large to prevent context window overflow.
	 * @returns The unretrieved output (truncated if necessary)
	 */
	getUnretrievedOutput(): string {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length

		// Truncate if too many lines to prevent context overflow
		const lines = unretrieved.split("\n")
		if (lines.length > MAX_UNRETRIEVED_LINES) {
			const first = lines.slice(0, TRUNCATE_KEEP_LINES)
			const last = lines.slice(-TRUNCATE_KEEP_LINES)
			const skipped = lines.length - first.length - last.length
			return this.removeLastLineArtifacts([...first, `\n... (${skipped} lines truncated) ...\n`, ...last].join("\n"))
		}

		return this.removeLastLineArtifacts(unretrieved)
	}

	getCompletionDetails(): TerminalCompletionDetails {
		return {
			exitCode: this.exitCode,
			signal: this.signal,
			terminalClosed: this.terminalClosedMidCommand,
		}
	}

	// some processing to remove artifacts like '%' at the end of the buffer (it seems that since vsode uses % at the beginning of newlines in terminal, it makes its way into the stream)
	// This modification will remove '%', '$', '#', or '>' followed by optional whitespace
	removeLastLineArtifacts(output: string) {
		const lines = output.trimEnd().split("\n")
		if (lines.length > 0) {
			const lastLine = lines[lines.length - 1]
			// Remove prompt characters and trailing whitespace from the last line
			lines[lines.length - 1] = lastLine.replace(/[%$#>]\s*$/, "")
		}
		return lines.join("\n").trimEnd()
	}
}

export type TerminalProcessResultPromise = VscodeTerminalProcess & Promise<void>

// Similar to execa's ResultPromise, this lets us create a mixin of both a TerminalProcess and a Promise: https://github.com/sindresorhus/execa/blob/main/lib/methods/promise.js
export function mergePromise(process: VscodeTerminalProcess, promise: Promise<void>): TerminalProcessResultPromise {
	const nativePromisePrototype = (async () => {})().constructor.prototype
	const descriptors = ["then", "catch", "finally"].map(
		(property) => [property, Reflect.getOwnPropertyDescriptor(nativePromisePrototype, property)] as const,
	)
	for (const [property, descriptor] of descriptors) {
		if (descriptor) {
			const value = descriptor.value.bind(promise)
			Reflect.defineProperty(process, property, { ...descriptor, value })
		}
	}
	return process as TerminalProcessResultPromise
}
