import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import { encodeSidecarEvent } from "./context";
import type { SidecarWebSocketClient } from "./types";

type TerminalEntry = {
	owner: SidecarWebSocketClient;
	proc: Bun.Subprocess;
	pending: string;
	flushTimer: ReturnType<typeof setTimeout> | null;
};

const terminals = new Map<string, TerminalEntry>();

// Coalesces bursts of PTY output into fewer transport messages.
const OUTPUT_FLUSH_MS = 4;

function resolveShell(): string {
	const candidates = [
		process.env.SHELL,
		process.platform === "darwin" ? "/bin/zsh" : undefined,
		"/bin/bash",
		"/bin/sh",
	];
	return candidates.find((shell) => shell && existsSync(shell)) ?? "/bin/sh";
}

function resolveCwd(cwd: unknown): string {
	if (typeof cwd === "string" && cwd.trim()) {
		try {
			if (statSync(cwd).isDirectory()) return cwd;
		} catch {}
	}
	return homedir();
}

function shellEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		// The approval token and endpoint grant control over this sidecar.
		if (value === undefined || key.startsWith("CLINE_SIDECAR_")) continue;
		env[key] = value;
	}
	return {
		...env,
		TERM: "xterm-256color",
		COLORTERM: "truecolor",
		TERM_PROGRAM: "ClineDesktop",
	};
}

function clampSize(value: unknown, fallback: number): number {
	const size = Math.floor(Number(value));
	return Number.isFinite(size) && size >= 2 ? Math.min(size, 1000) : fallback;
}

function send(entry: TerminalEntry, name: string, payload: unknown): void {
	try {
		entry.owner.send(encodeSidecarEvent(name, payload));
	} catch {
		closeTerminalsForOwner(entry.owner);
	}
}

function flush(id: string, entry: TerminalEntry): void {
	entry.flushTimer = null;
	if (!entry.pending) return;
	const data = entry.pending;
	entry.pending = "";
	send(entry, "terminal_output", { id, data });
}

function getOwnedTerminal(
	args: Record<string, unknown> | undefined,
	connection: SidecarWebSocketClient,
): Bun.Terminal | undefined {
	const entry = terminals.get(String(args?.id ?? ""));
	return entry?.owner === connection ? entry.proc.terminal : undefined;
}

export function handleTerminalCommand(
	command: string,
	args: Record<string, unknown> | undefined,
	connection: SidecarWebSocketClient | undefined,
): unknown {
	// A terminal runs arbitrary commands, so only the approval-token webview
	// connection may open or drive one.
	if (!connection?.data?.canApproveTools) {
		throw new Error("terminals require a trusted desktop connection");
	}
	switch (command) {
		case "terminal_create": {
			if (process.platform === "win32") {
				throw new Error(
					"The integrated terminal isn't available on Windows yet.",
				);
			}
			const id = randomUUID();
			const cwd = resolveCwd(args?.cwd);
			const decoder = new TextDecoder();
			const shell = resolveShell();
			const proc = Bun.spawn([shell, "-l"], {
				cwd,
				env: shellEnv(),
				terminal: {
					cols: clampSize(args?.cols, 80),
					rows: clampSize(args?.rows, 24),
					data(_terminal, data) {
						entry.pending += decoder.decode(data, { stream: true });
						entry.flushTimer ??= setTimeout(
							() => flush(id, entry),
							OUTPUT_FLUSH_MS,
						);
					},
				},
			});
			const entry: TerminalEntry = {
				owner: connection,
				proc,
				pending: "",
				flushTimer: null,
			};
			terminals.set(id, entry);
			void entry.proc.exited.then((exitCode) => {
				if (entry.flushTimer) clearTimeout(entry.flushTimer);
				flush(id, entry);
				entry.proc.terminal?.close();
				if (terminals.get(id) === entry) {
					terminals.delete(id);
					send(entry, "terminal_exit", { id, exitCode });
				}
			});
			return { id, cwd, shell: basename(shell) };
		}
		case "terminal_write": {
			getOwnedTerminal(args, connection)?.write(String(args?.data ?? ""));
			return null;
		}
		case "terminal_resize": {
			getOwnedTerminal(args, connection)?.resize(
				clampSize(args?.cols, 80),
				clampSize(args?.rows, 24),
			);
			return null;
		}
		case "terminal_close": {
			const id = String(args?.id ?? "");
			const entry = terminals.get(id);
			if (entry?.owner === connection) {
				terminals.delete(id);
				entry.proc.kill("SIGHUP");
			}
			return null;
		}
		default:
			throw new Error(`unknown terminal command: ${command}`);
	}
}

/** Shells die with the webview connection that opened them. */
export function closeTerminalsForOwner(owner: SidecarWebSocketClient): void {
	for (const [id, entry] of terminals) {
		if (entry.owner !== owner) continue;
		terminals.delete(id);
		entry.proc.kill("SIGHUP");
	}
}
