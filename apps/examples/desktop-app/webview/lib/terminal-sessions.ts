"use client";

import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { isTauriAvailable } from "@/lib/desktop-client";

/**
 * Terminal tabs live outside React, keyed by the directory they were opened
 * in, so switching sessions (which remounts the chat pane) reattaches the
 * same shell and scrollback instead of spawning a new one.
 */
export type TerminalTab = {
	id: string;
	cwd: string;
	label: string;
	term: Terminal;
	fit: FitAddon;
	/** xterm renders into this element; the panel moves it into place. */
	element: HTMLDivElement;
	opened: boolean;
	/** "new" allows (re)starting; "exited" tabs are about to be removed. */
	status: "new" | "starting" | "running" | "exited";
	/** Native shell handle; null until spawned and after exit. */
	pty: {
		write: (data: string) => void;
		resize: (cols: number, rows: number) => void;
	} | null;
};

type PtyEvent =
	| { type: "data"; data: string }
	| { type: "exit"; code?: number };

const tabsByCwd = new Map<string, TerminalTab[]>();
const activeIdByCwd = new Map<string, string>();
const listeners = new Set<() => void>();
let nextTabNumber = 1;

function emit(): void {
	for (const listener of listeners) listener();
}

export function subscribeTerminalTabs(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function normalizeTerminalCwd(cwd: string): string {
	const trimmed = cwd.trim();
	if (!trimmed) return "~";
	const stripped = trimmed.replace(/[\\/]+$/, "");
	// Filesystem roots keep their separator: "/" and "C:\" are directories,
	// "" and "C:" are not.
	if (!stripped) return trimmed.slice(0, 1);
	if (/^[A-Za-z]:$/.test(stripped)) return `${stripped}\\`;
	return stripped;
}

const EMPTY: TerminalTab[] = [];

export function listTerminalTabs(cwd: string): TerminalTab[] {
	return tabsByCwd.get(normalizeTerminalCwd(cwd)) ?? EMPTY;
}

export function activeTerminalTabId(cwd: string): string | null {
	const key = normalizeTerminalCwd(cwd);
	const tabs = tabsByCwd.get(key);
	if (!tabs || tabs.length === 0) return null;
	const active = activeIdByCwd.get(key);
	return tabs.some((tab) => tab.id === active) ? (active ?? null) : tabs[0].id;
}

export function setActiveTerminalTab(cwd: string, id: string): void {
	activeIdByCwd.set(normalizeTerminalCwd(cwd), id);
	emit();
}

function basename(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

function tabLabel(key: string, existing: TerminalTab[]): string {
	const base = key === "~" ? "home" : basename(key);
	const taken = new Set(existing.map((tab) => tab.label));
	if (!taken.has(base)) return base;
	for (let n = 2; ; n += 1) {
		const candidate = `${base} ${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/**
 * xterm only understands sRGB-ish color syntax, while the theme tokens are
 * oklch(); a canvas fill round-trips any CSS color into #rrggbb.
 */
function resolveCssColor(value: string, fallback: string): string {
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) return fallback;
	context.fillStyle = "#000";
	context.fillStyle = trimmed;
	const resolved = context.fillStyle;
	return typeof resolved === "string" && resolved !== "#000000"
		? resolved
		: fallback;
}

export function readTerminalTheme(): ITheme {
	const styles = getComputedStyle(document.documentElement);
	const dark = document.documentElement.classList.contains("dark");
	const background = resolveCssColor(
		styles.getPropertyValue("--background"),
		dark ? "#09090b" : "#ffffff",
	);
	const foreground = resolveCssColor(
		styles.getPropertyValue("--foreground"),
		dark ? "#e4e4e7" : "#18181b",
	);
	const primary = resolveCssColor(
		styles.getPropertyValue("--primary"),
		dark ? "#a78bfa" : "#7c3aed",
	);
	const muted = resolveCssColor(
		styles.getPropertyValue("--muted-foreground"),
		dark ? "#a1a1aa" : "#71717a",
	);
	return {
		background,
		foreground,
		cursor: primary,
		cursorAccent: dark ? "#000000" : "#ffffff",
		selectionBackground: dark
			? "rgba(167, 139, 250, 0.35)"
			: "rgba(124, 58, 237, 0.25)",
		brightBlack: muted,
		// The stock dark palette's yellow and cyan wash out on a light surface.
		...(dark
			? {}
			: {
					yellow: "#a16207",
					brightYellow: "#ca8a04",
					cyan: "#0e7490",
					brightCyan: "#0891b2",
					white: "#52525b",
					brightWhite: "#18181b",
					green: "#15803d",
					brightGreen: "#16a34a",
				}),
	};
}

function readMonoFontFamily(): string {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue("--font-mono")
		.trim();
	return value || "ui-monospace, Menlo, Consolas, monospace";
}

export function createTerminalTab(cwd: string): TerminalTab {
	const key = normalizeTerminalCwd(cwd);
	const existing = tabsByCwd.get(key) ?? [];
	const term = new Terminal({
		allowProposedApi: true,
		cursorBlink: true,
		cursorStyle: "bar",
		fontFamily: readMonoFontFamily(),
		fontSize: 12.5,
		lineHeight: 1.2,
		scrollback: 5_000,
		macOptionIsMeta: true,
		theme: readTerminalTheme(),
	});
	// Let the panel toggle shortcut reach the app's window handler instead of
	// being swallowed as terminal input.
	term.attachCustomKeyEventHandler(
		(event) => !(event.ctrlKey && event.code === "Backquote"),
	);
	const fit = new FitAddon();
	term.loadAddon(fit);
	const element = document.createElement("div");
	element.className = "h-full w-full";
	const tab: TerminalTab = {
		id: `term_${Date.now().toString(36)}_${nextTabNumber++}`,
		cwd: key,
		label: tabLabel(key, existing),
		term,
		fit,
		element,
		opened: false,
		status: "new",
		pty: null,
	};
	// Registered once here rather than per spawn attempt, so a retried start
	// cannot stack listeners and send every keystroke twice.
	term.onData((data) => tab.pty?.write(data));
	term.onResize(({ cols, rows }) => tab.pty?.resize(cols, rows));
	tabsByCwd.set(key, [...existing, tab]);
	activeIdByCwd.set(key, tab.id);
	emit();
	return tab;
}

function removeTab(tab: TerminalTab): void {
	const tabs = tabsByCwd.get(tab.cwd);
	if (!tabs) return;
	const index = tabs.indexOf(tab);
	if (index === -1) return;
	const next = tabs.filter((candidate) => candidate !== tab);
	if (next.length === 0) {
		tabsByCwd.delete(tab.cwd);
		activeIdByCwd.delete(tab.cwd);
	} else {
		tabsByCwd.set(tab.cwd, next);
		if (activeIdByCwd.get(tab.cwd) === tab.id) {
			activeIdByCwd.set(tab.cwd, next[Math.min(index, next.length - 1)].id);
		}
	}
	tab.term.dispose();
	tab.element.remove();
	emit();
}

export async function killTerminalTab(tab: TerminalTab): Promise<void> {
	const wasLive = tab.status === "starting" || tab.status === "running";
	tab.status = "exited";
	tab.pty = null;
	removeTab(tab);
	if (wasLive && isTauriAvailable()) {
		const { invoke } = await import("@tauri-apps/api/core");
		await invoke("terminal_kill", { id: tab.id }).catch(() => {
			// Already gone.
		});
	}
}

export function applyTerminalTheme(): void {
	const theme = readTerminalTheme();
	for (const tabs of tabsByCwd.values()) {
		for (const tab of tabs) {
			tab.term.options.theme = theme;
		}
	}
}

/**
 * Starts the shell for a tab the first time it is shown. Output streams
 * straight into xterm; when the shell exits the tab closes itself, matching
 * how editors treat a finished terminal.
 */
export async function spawnTerminalTab(tab: TerminalTab): Promise<void> {
	if (tab.status !== "new") return;
	tab.status = "starting";
	if (!isTauriAvailable()) {
		tab.status = "exited";
		tab.term.writeln(
			"\x1b[2mThe integrated terminal needs the desktop app; it is unavailable in browser mode.\x1b[0m",
		);
		return;
	}
	const { Channel, invoke } = await import("@tauri-apps/api/core");
	const channel = new Channel<PtyEvent>();
	channel.onmessage = (event) => {
		if (event.type === "data") {
			tab.term.write(event.data);
			return;
		}
		if (tab.status === "exited") return;
		tab.status = "exited";
		tab.pty = null;
		// Let the shell's final output land before the tab goes away.
		window.setTimeout(() => void removeTab(tab), 150);
	};
	tab.pty = {
		write: (data) => {
			void invoke("terminal_write", { id: tab.id, data }).catch(() => {
				// The shell exited between the keystroke and the write.
			});
		},
		resize: (cols, rows) => {
			void invoke("terminal_resize", { id: tab.id, cols, rows }).catch(() => {
				// Resize races with exit; nothing to do.
			});
		},
	};
	try {
		await invoke("terminal_spawn", {
			options: {
				id: tab.id,
				cwd: tab.cwd === "~" ? null : tab.cwd,
				cols: tab.term.cols,
				rows: tab.term.rows,
			},
			onEvent: channel,
		});
		if (tab.status === "starting") tab.status = "running";
	} catch (error) {
		// Back to "new" so showing the tab again retries the spawn.
		tab.status = "new";
		tab.pty = null;
		const message = error instanceof Error ? error.message : String(error);
		tab.term.writeln(`\x1b[31m${message}\x1b[0m`);
	}
}
