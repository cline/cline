import { EventEmitter } from "events"

import type { RooTerminalProcess, RooTerminalProcessEvents, ExitCodeDetails } from "./types"

export abstract class BaseTerminalProcess extends EventEmitter<RooTerminalProcessEvents> implements RooTerminalProcess {
	public command: string = ""

	public isHot: boolean = false
	protected hotTimer: NodeJS.Timeout | null = null

	protected isListening: boolean = true
	protected lastEmitTime_ms: number = 0
	protected fullOutput: string = ""
	protected lastRetrievedIndex: number = 0

	static interpretExitCode(exitCode: number | undefined): ExitCodeDetails {
		if (exitCode === undefined) {
			return { exitCode }
		}

		if (exitCode <= 128) {
			return { exitCode }
		}

		const signal = exitCode - 128

		const signals: Record<number, string> = {
			// Standard signals
			1: "SIGHUP",
			2: "SIGINT",
			3: "SIGQUIT",
			4: "SIGILL",
			5: "SIGTRAP",
			6: "SIGABRT",
			7: "SIGBUS",
			8: "SIGFPE",
			9: "SIGKILL",
			10: "SIGUSR1",
			11: "SIGSEGV",
			12: "SIGUSR2",
			13: "SIGPIPE",
			14: "SIGALRM",
			15: "SIGTERM",
			16: "SIGSTKFLT",
			17: "SIGCHLD",
			18: "SIGCONT",
			19: "SIGSTOP",
			20: "SIGTSTP",
			21: "SIGTTIN",
			22: "SIGTTOU",
			23: "SIGURG",
			24: "SIGXCPU",
			25: "SIGXFSZ",
			26: "SIGVTALRM",
			27: "SIGPROF",
			28: "SIGWINCH",
			29: "SIGIO",
			30: "SIGPWR",
			31: "SIGSYS",

			// Real-time signals base
			34: "SIGRTMIN",

			// SIGRTMIN+n signals
			35: "SIGRTMIN+1",
			36: "SIGRTMIN+2",
			37: "SIGRTMIN+3",
			38: "SIGRTMIN+4",
			39: "SIGRTMIN+5",
			40: "SIGRTMIN+6",
			41: "SIGRTMIN+7",
			42: "SIGRTMIN+8",
			43: "SIGRTMIN+9",
			44: "SIGRTMIN+10",
			45: "SIGRTMIN+11",
			46: "SIGRTMIN+12",
			47: "SIGRTMIN+13",
			48: "SIGRTMIN+14",
			49: "SIGRTMIN+15",

			// SIGRTMAX-n signals
			50: "SIGRTMAX-14",
			51: "SIGRTMAX-13",
			52: "SIGRTMAX-12",
			53: "SIGRTMAX-11",
			54: "SIGRTMAX-10",
			55: "SIGRTMAX-9",
			56: "SIGRTMAX-8",
			57: "SIGRTMAX-7",
			58: "SIGRTMAX-6",
			59: "SIGRTMAX-5",
			60: "SIGRTMAX-4",
			61: "SIGRTMAX-3",
			62: "SIGRTMAX-2",
			63: "SIGRTMAX-1",
			64: "SIGRTMAX",
		}

		// These signals may produce core dumps:
		//   SIGQUIT, SIGILL, SIGABRT, SIGBUS, SIGFPE, SIGSEGV
		const coreDumpPossible = new Set([3, 4, 6, 7, 8, 11])

		return {
			exitCode,
			signal,
			signalName: signals[signal] || `Unknown Signal (${signal})`,
			coreDumpPossible: coreDumpPossible.has(signal),
		}
	}

	/**
	 * Runs a shell command.
	 * @param command The command to run
	 */
	abstract run(command: string): Promise<void>

	/**
	 * Continues the process in the background.
	 */
	abstract continue(): void

	/**
	 * Aborts the process via a SIGINT.
	 */
	abstract abort(): void

	/**
	 * Checks if this process has unretrieved output.
	 * @returns true if there is output that hasn't been fully retrieved yet
	 */
	abstract hasUnretrievedOutput(): boolean

	/**
	 * Returns complete lines with their carriage returns.
	 * The final line may lack a carriage return if the program didn't send one.
	 * @returns The unretrieved output
	 */
	abstract getUnretrievedOutput(): string

	protected startHotTimer(data: string) {
		this.isHot = true

		if (this.hotTimer) {
			clearTimeout(this.hotTimer)
		}

		this.hotTimer = setTimeout(() => (this.isHot = false), BaseTerminalProcess.isCompiling(data) ? 15_000 : 2_000)
	}

	protected stopHotTimer() {
		if (this.hotTimer) {
			clearTimeout(this.hotTimer)
		}

		this.isHot = false
	}

	// These markers indicate the command is some kind of local dev
	// server recompiling the app, which we want to wait for output
	// of before sending request to Roo Code.
	private static compilingMarkers = ["compiling", "building", "bundling", "transpiling", "generating", "starting"]

	private static compilingMarkerNullifiers = [
		"compiled",
		"success",
		"finish",
		"complete",
		"succeed",
		"done",
		"end",
		"stop",
		"exit",
		"terminate",
		"error",
		"fail",
	]

	private static isCompiling(data: string): boolean {
		return (
			BaseTerminalProcess.compilingMarkers.some((marker) => data.toLowerCase().includes(marker.toLowerCase())) &&
			!BaseTerminalProcess.compilingMarkerNullifiers.some((nullifier) =>
				data.toLowerCase().includes(nullifier.toLowerCase()),
			)
		)
	}
}
