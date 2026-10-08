import type { FitAddon } from "@xterm/addon-fit";
import type { ITheme, Terminal } from "@xterm/xterm";
import { desktopClient } from "@/lib/desktop-client";

export type TerminalTab = {
	id: string;
	/** Home terminals share the "home" scope; session terminals are keyed by cwd. */
	scope: string;
	cwd?: string;
	title: string;
	element: HTMLDivElement;
	term?: Terminal;
	fit?: FitAddon;
	backendId?: string;
	started?: boolean;
	pendingInput: string;
};

type TerminalState = {
	tabs: readonly TerminalTab[];
	active: Readonly<Record<string, string>>;
	open: boolean;
	available: boolean;
};

let state: TerminalState = {
	tabs: [],
	active: {},
	open: false,
	available: false,
};
const listeners = new Set<() => void>();

function setState(next: Partial<TerminalState>): void {
	state = { ...state, ...next };
	for (const listener of listeners) listener();
}

export function getTerminalState(): TerminalState {
	return state;
}

export function subscribeTerminalState(listener: () => void): () => void {
	wireTransport();
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function setTerminalPanelOpen(open: boolean): void {
	if (state.open !== open) setState({ open });
}

export function toggleTerminalPanel(): void {
	if (state.available) setState({ open: !state.open });
}

export function setTerminalAvailable(available: boolean): void {
	if (state.available !== available) setState({ available });
}

export function addTerminal(scope: string, cwd?: string): void {
	const element = document.createElement("div");
	element.className = "h-full w-full";
	const tab: TerminalTab = {
		id: crypto.randomUUID(),
		scope,
		cwd,
		title: "Terminal",
		element,
		pendingInput: "",
	};
	setState({
		tabs: [...state.tabs, tab],
		active: { ...state.active, [scope]: tab.id },
	});
}

export function setActiveTerminal(scope: string, id: string): void {
	setState({ active: { ...state.active, [scope]: id } });
}

export function closeTerminal(tab: TerminalTab): void {
	if (tab.backendId) {
		void desktopClient
			.invoke("terminal_close", { id: tab.backendId })
			.catch(() => {});
	}
	removeTabs([tab]);
}

function removeTabs(removed: readonly TerminalTab[]): void {
	if (removed.length === 0) return;
	for (const tab of removed) {
		tab.term?.dispose();
		tab.element.remove();
	}
	const tabs = state.tabs.filter((tab) => !removed.includes(tab));
	const active = { ...state.active };
	for (const [scope, id] of Object.entries(active)) {
		if (tabs.some((tab) => tab.id === id)) continue;
		const fallback = tabs.findLast((tab) => tab.scope === scope);
		if (fallback) active[scope] = fallback.id;
		else delete active[scope];
	}
	setState({ tabs, active });
}

/** Shows `tab` inside `container`, starting its shell on first use. */
export function attachTerminal(tab: TerminalTab, container: HTMLElement): void {
	if (tab.element.parentElement !== container) {
		container.replaceChildren(tab.element);
	}
	if (tab.term) {
		tab.term.options.theme = themeFor(container);
		tab.fit?.fit();
		tab.term.focus();
		return;
	}
	void startTerminal(tab, container);
}

async function startTerminal(
	tab: TerminalTab,
	container: HTMLElement,
): Promise<void> {
	if (tab.started) return;
	tab.started = true;
	const [{ Terminal }, { FitAddon }] = await Promise.all([
		import("@xterm/xterm"),
		import("@xterm/addon-fit"),
	]);
	const fontFamily =
		getComputedStyle(container).getPropertyValue("--font-mono").trim() ||
		"monospace";
	// Cell metrics are measured on open, so the mono font must be ready first.
	await document.fonts.load(`13px ${fontFamily}`).catch(() => {});
	if (!state.tabs.includes(tab)) return;

	const term = new Terminal({
		cursorBlink: true,
		fontFamily,
		fontSize: 12.5,
		lineHeight: 1.25,
		macOptionIsMeta: true,
		scrollback: 5000,
		theme: themeFor(container),
	});
	const fit = new FitAddon();
	term.loadAddon(fit);
	term.open(tab.element);
	fit.fit();
	tab.term = term;
	tab.fit = fit;
	term.onData((data) => {
		if (tab.backendId) writeToShell(tab.backendId, data);
		else tab.pendingInput += data;
	});
	term.onResize(({ cols, rows }) => {
		if (!tab.backendId) return;
		void desktopClient
			.invoke("terminal_resize", { id: tab.backendId, cols, rows })
			.catch(() => {});
	});
	term.focus();

	try {
		const result = await desktopClient.invoke<{ id: string; shell: string }>(
			"terminal_create",
			{ cwd: tab.cwd, cols: term.cols, rows: term.rows },
		);
		if (!state.tabs.includes(tab)) {
			void desktopClient
				.invoke("terminal_close", { id: result.id })
				.catch(() => {});
			return;
		}
		tab.backendId = result.id;
		tab.title = result.shell;
		if (tab.pendingInput) {
			writeToShell(result.id, tab.pendingInput);
			tab.pendingInput = "";
		}
		setState({ tabs: [...state.tabs] });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		term.write(`\x1b[31m${message}\x1b[0m\r\n`);
	}
}

function writeToShell(id: string, data: string): void {
	void desktopClient.invoke("terminal_write", { id, data }).catch(() => {});
}

let transportWired = false;

function wireTransport(): void {
	if (transportWired) return;
	transportWired = true;
	const findTab = (payload: unknown) => {
		const id = (payload as { id?: unknown } | null)?.id;
		return state.tabs.find((tab) => tab.backendId === id);
	};
	desktopClient.subscribe("terminal_output", (payload) => {
		const data = (payload as { data?: unknown }).data;
		if (typeof data === "string") findTab(payload)?.term?.write(data);
	});
	desktopClient.subscribe("terminal_exit", (payload) => {
		const tab = findTab(payload);
		if (tab) removeTabs([tab]);
	});
	// The sidecar kills a connection's shells when it drops, so every tab that
	// was attached to the old connection is gone.
	let connected = false;
	desktopClient.subscribeTransportState((transportState) => {
		if (connected && transportState !== "connected") {
			removeTabs(state.tabs.filter((tab) => tab.started));
		}
		connected = transportState === "connected";
	});
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const DARK_ANSI: ITheme = {
	black: "#000000",
	red: "#cd3131",
	green: "#0dbc79",
	yellow: "#e5e510",
	blue: "#2472c8",
	magenta: "#bc3fbc",
	cyan: "#11a8cd",
	white: "#e5e5e5",
	brightBlack: "#666666",
	brightRed: "#f14c4c",
	brightGreen: "#23d18b",
	brightYellow: "#f5f543",
	brightBlue: "#3b8eea",
	brightMagenta: "#d670d6",
	brightCyan: "#29b8db",
	brightWhite: "#e5e5e5",
};

const LIGHT_ANSI: ITheme = {
	black: "#000000",
	red: "#cd3131",
	green: "#00bc00",
	yellow: "#949800",
	blue: "#0451a5",
	magenta: "#bc05bc",
	cyan: "#0598bc",
	white: "#555555",
	brightBlack: "#666666",
	brightRed: "#cd3131",
	brightGreen: "#14ce14",
	brightYellow: "#b5ba00",
	brightBlue: "#0451a5",
	brightMagenta: "#bc05bc",
	brightCyan: "#0598bc",
	brightWhite: "#a5a5a5",
};

/** Normalizes any CSS color (theme tokens are oklch) to rgb channels. */
function toRgb(color: string): [number, number, number] {
	const context = document.createElement("canvas").getContext("2d");
	if (!context) return [0, 0, 0];
	context.fillStyle = color;
	context.fillRect(0, 0, 1, 1);
	const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
	return [r, g, b];
}

function themeFor(container: HTMLElement): ITheme {
	const style = getComputedStyle(container);
	const [br, bg, bb] = toRgb(style.backgroundColor);
	const [fr, fg, fb] = toRgb(style.color);
	const dark = 0.2126 * br + 0.7152 * bg + 0.0722 * bb < 128;
	return {
		...(dark ? DARK_ANSI : LIGHT_ANSI),
		background: `rgb(${br}, ${bg}, ${bb})`,
		foreground: `rgb(${fr}, ${fg}, ${fb})`,
		cursor: `rgb(${fr}, ${fg}, ${fb})`,
		cursorAccent: `rgb(${br}, ${bg}, ${bb})`,
		selectionBackground: `rgba(${fr}, ${fg}, ${fb}, 0.25)`,
	};
}
