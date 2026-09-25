import { randomUUID } from "node:crypto";

/**
 * Integrated-terminal shells for the desktop app. Each shell is a PTY-backed
 * process (Bun's native `terminal` spawn option) started in a task's working
 * directory, grouped under a `scopeId` (the chat session or thread) so the
 * webview can list the shells that belong to the task it is showing.
 *
 * Output is streamed to the webview as `terminal_data` events and mirrored
 * into a bounded backlog so a panel that remounts (switching tasks, reloading
 * the webview) can restore what the shell already printed.
 */

export type TerminalInfo = {
	id: string;
	scopeId: string;
	title: string;
	cwd: string;
	pid: number;
};

export type TerminalDataEvent = { id: string; data: string };
export type TerminalExitEvent = { id: string; exitCode: number | null };

type TerminalEmitter = (name: string, payload: unknown) => void;

export type TerminalProcess = {
	pid: number;
	exited: Promise<number | null>;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(): void;
};

export type SpawnTerminal = (options: {
	cwd: string;
	cols: number;
	rows: number;
	onData: (chunk: Uint8Array) => void;
}) => TerminalProcess;

type TerminalRecord = {
	info: TerminalInfo;
	proc: TerminalProcess;
	backlog: Uint8Array[];
	backlogBytes: number;
	exited: boolean;
};

/** Enough to restore a few screens of a busy build log. */
const BACKLOG_LIMIT_BYTES = 512 * 1024;
const MIN_COLS = 2;
const MIN_ROWS = 1;

export function resolveInteractiveShell(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): { binary: string; args: string[] } {
	if (platform === "win32") {
		const comspec = env.COMSPEC?.trim();
		return comspec
			? { binary: comspec, args: [] }
			: { binary: "powershell.exe", args: ["-NoLogo"] };
	}
	const shell = env.SHELL?.trim();
	if (shell) {
		// A login shell mirrors what Terminal.app / most Linux terminals spawn,
		// so the user's profile (PATH, version managers) is loaded.
		return { binary: shell, args: platform === "darwin" ? ["-l"] : [] };
	}
	return { binary: "/bin/bash", args: [] };
}

export function isTerminalSupported(): boolean {
	return (
		process.platform !== "win32" &&
		typeof (Bun as { Terminal?: unknown }).Terminal === "function"
	);
}

function spawnBunTerminal({
	cwd,
	cols,
	rows,
	onData,
}: Parameters<SpawnTerminal>[0]): TerminalProcess {
	const shell = resolveInteractiveShell();
	const proc = Bun.spawn([shell.binary, ...shell.args], {
		cwd,
		env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
		terminal: {
			cols,
			rows,
			name: "xterm-256color",
			data: (_terminal, data) => onData(data),
		},
	});
	const terminal = proc.terminal;
	if (!terminal) {
		proc.kill();
		throw new Error("The shell could not be attached to a pseudo-terminal.");
	}
	return {
		pid: proc.pid,
		exited: proc.exited.then(
			(code) => code,
			() => null,
		),
		write: (data) => {
			terminal.write(data);
		},
		resize: (nextCols, nextRows) => terminal.resize(nextCols, nextRows),
		kill: () => {
			proc.kill();
			terminal.close();
		},
	};
}

function clampGeometry(
	cols: unknown,
	rows: unknown,
): {
	cols: number;
	rows: number;
} {
	const toInt = (value: unknown, fallback: number, min: number) =>
		typeof value === "number" && Number.isFinite(value)
			? Math.max(min, Math.floor(value))
			: fallback;
	return { cols: toInt(cols, 80, MIN_COLS), rows: toInt(rows, 24, MIN_ROWS) };
}

let sharedManager: TerminalSessionManager | undefined;

export function getTerminalSessionManager(
	emit: TerminalEmitter,
): TerminalSessionManager {
	sharedManager ??= new TerminalSessionManager(emit);
	return sharedManager;
}

export function disposeTerminalSessions(): void {
	sharedManager?.disposeAll();
	sharedManager = undefined;
}

export class TerminalSessionManager {
	private readonly terminals = new Map<string, TerminalRecord>();

	constructor(
		private readonly emit: TerminalEmitter,
		private readonly spawn: SpawnTerminal = spawnBunTerminal,
	) {}

	open(options: {
		scopeId: string;
		cwd: string;
		cols?: number;
		rows?: number;
	}): TerminalInfo {
		const scopeId = options.scopeId.trim();
		const cwd = options.cwd.trim();
		if (!scopeId) throw new Error("scopeId is required");
		if (!cwd) throw new Error("cwd is required");
		const { cols, rows } = clampGeometry(options.cols, options.rows);
		const id = randomUUID();
		const shell = resolveInteractiveShell();
		const title = shell.binary.split(/[\\/]/).pop() || "shell";
		let record: TerminalRecord | undefined;
		const proc = this.spawn({
			cwd,
			cols,
			rows,
			onData: (chunk) => {
				if (!record || record.exited) return;
				this.appendBacklog(record, chunk);
				this.emit("terminal_data", {
					id,
					data: Buffer.from(chunk).toString("base64"),
				} satisfies TerminalDataEvent);
			},
		});
		record = {
			info: { id, scopeId, title, cwd, pid: proc.pid },
			proc,
			backlog: [],
			backlogBytes: 0,
			exited: false,
		};
		this.terminals.set(id, record);
		void proc.exited.then((exitCode) => {
			const current = this.terminals.get(id);
			if (!current || current.exited) return;
			current.exited = true;
			this.terminals.delete(id);
			this.emit("terminal_exit", { id, exitCode } satisfies TerminalExitEvent);
		});
		return record.info;
	}

	list(scopeId: string): TerminalInfo[] {
		return [...this.terminals.values()]
			.filter((record) => record.info.scopeId === scopeId)
			.map((record) => record.info);
	}

	/** Current metadata plus the buffered output, base64-encoded. */
	attach(id: string): { info: TerminalInfo; backlog: string } {
		const record = this.require(id);
		return {
			info: record.info,
			backlog: Buffer.concat(record.backlog).toString("base64"),
		};
	}

	write(id: string, data: string): void {
		if (typeof data !== "string" || data.length === 0) return;
		this.require(id).proc.write(data);
	}

	resize(id: string, cols: number, rows: number): void {
		const geometry = clampGeometry(cols, rows);
		this.require(id).proc.resize(geometry.cols, geometry.rows);
	}

	close(id: string): void {
		const record = this.terminals.get(id);
		if (!record) return;
		record.exited = true;
		this.terminals.delete(id);
		record.proc.kill();
	}

	/**
	 * Move a task's shells from a provisional key to the real one (a thread
	 * only learns its session id once the first prompt is sent).
	 */
	rescope(fromScopeId: string, toScopeId: string): number {
		let moved = 0;
		for (const record of this.terminals.values()) {
			if (record.info.scopeId === fromScopeId) {
				record.info = { ...record.info, scopeId: toScopeId };
				moved += 1;
			}
		}
		return moved;
	}

	disposeAll(): void {
		for (const id of [...this.terminals.keys()]) {
			this.close(id);
		}
	}

	private require(id: string): TerminalRecord {
		const record = this.terminals.get(id);
		if (!record) throw new Error(`Terminal ${id} is no longer open.`);
		return record;
	}

	private appendBacklog(record: TerminalRecord, chunk: Uint8Array): void {
		record.backlog.push(chunk);
		record.backlogBytes += chunk.byteLength;
		while (
			record.backlogBytes > BACKLOG_LIMIT_BYTES &&
			record.backlog.length > 1
		) {
			const dropped = record.backlog.shift();
			record.backlogBytes -= dropped?.byteLength ?? 0;
		}
	}
}
