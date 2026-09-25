"use client";

import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { desktopClient } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";
import "@xterm/xterm/css/xterm.css";

const RESIZE_DEBOUNCE_MS = 60;

const ANSI_DARK = {
	black: "#3b3b45",
	red: "#f26d78",
	green: "#5fcf8f",
	yellow: "#e8c46a",
	blue: "#7aa2f7",
	magenta: "#b18cf7",
	cyan: "#5fd3d6",
	white: "#c8c8d1",
	brightBlack: "#5a5a66",
	brightRed: "#ff8a94",
	brightGreen: "#7fe0a8",
	brightYellow: "#f5d688",
	brightBlue: "#98b8ff",
	brightMagenta: "#c8a8ff",
	brightCyan: "#7fe6e8",
	brightWhite: "#f2f2f5",
};

const ANSI_LIGHT = {
	black: "#1c2024",
	red: "#c8323f",
	green: "#1f8a4c",
	yellow: "#9a6b00",
	blue: "#2f5fd0",
	magenta: "#7a3fd6",
	cyan: "#0e7f86",
	white: "#8b8d98",
	brightBlack: "#5f606a",
	brightRed: "#e04150",
	brightGreen: "#26a35b",
	brightYellow: "#b57f00",
	brightBlue: "#3f74ec",
	brightMagenta: "#8f55ee",
	brightCyan: "#15979f",
	brightWhite: "#b9bbc6",
};

function cssVar(name: string, fallback: string): string {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
	return value || fallback;
}

/** Terminal colors follow the app theme tokens; ANSI colors are fixed per scheme. */
function readTerminalTheme(): ITheme {
	const dark = document.documentElement.classList.contains("dark");
	return {
		background: cssVar("--surface-1", dark ? "#121216" : "#fcfcfd"),
		foreground: cssVar("--text-1", dark ? "#fcfcfd" : "#1c2024"),
		cursor: cssVar("--text-1", dark ? "#fcfcfd" : "#1c2024"),
		cursorAccent: cssVar("--surface-1", dark ? "#121216" : "#fcfcfd"),
		selectionBackground: cssVar("--selection-background", "#845ffd5f"),
		...(dark ? ANSI_DARK : ANSI_LIGHT),
	};
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

/**
 * One xterm surface bound to a sidecar shell. Mounting replays the shell's
 * buffered output, then streams live data; keystrokes and resizes go back
 * over the same transport.
 */
export function TerminalView({
	terminalId,
	autoFocus = false,
	className,
}: {
	terminalId: string;
	autoFocus?: boolean;
	className?: string;
}) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const terminal = new Terminal({
			cursorBlink: true,
			fontFamily:
				"'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
			fontSize: 12,
			lineHeight: 1.25,
			scrollback: 5000,
			macOptionIsMeta: true,
			theme: readTerminalTheme(),
		});
		const fit = new FitAddon();
		terminal.loadAddon(fit);
		terminal.open(container);

		let disposed = false;
		// Live chunks that arrive before the backlog replay finishes are held so
		// they are written after it, keeping the stream in order.
		let pending: Uint8Array[] | null = [];
		const unsubscribe = desktopClient.subscribe("terminal_data", (payload) => {
			const event = payload as { id?: unknown; data?: unknown } | null;
			if (event?.id !== terminalId || typeof event.data !== "string") return;
			const bytes = base64ToBytes(event.data);
			if (pending) pending.push(bytes);
			else terminal.write(bytes);
		});

		const syncSize = () => {
			if (
				disposed ||
				container.clientWidth === 0 ||
				container.clientHeight === 0
			)
				return;
			fit.fit();
			void desktopClient
				.invoke("terminal_resize", {
					id: terminalId,
					cols: terminal.cols,
					rows: terminal.rows,
				})
				.catch(() => undefined);
		};

		void desktopClient
			.invoke<{ backlog?: string }>("terminal_attach", { id: terminalId })
			.then((result) => {
				if (disposed) return;
				if (result?.backlog) terminal.write(base64ToBytes(result.backlog));
			})
			.catch((error: unknown) => {
				if (disposed) return;
				const message = error instanceof Error ? error.message : String(error);
				terminal.writeln(`\x1b[31m${message}\x1b[0m`);
			})
			.finally(() => {
				if (disposed) return;
				for (const chunk of pending ?? []) terminal.write(chunk);
				pending = null;
				syncSize();
				if (autoFocus) terminal.focus();
			});

		const input = terminal.onData((data) => {
			void desktopClient
				.invoke("terminal_write", { id: terminalId, data })
				.catch(() => undefined);
		});

		let resizeTimer: number | undefined;
		const observer = new ResizeObserver(() => {
			window.clearTimeout(resizeTimer);
			resizeTimer = window.setTimeout(syncSize, RESIZE_DEBOUNCE_MS);
		});
		observer.observe(container);

		const themeObserver = new MutationObserver(() => {
			terminal.options.theme = readTerminalTheme();
		});
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});

		return () => {
			disposed = true;
			window.clearTimeout(resizeTimer);
			unsubscribe();
			input.dispose();
			observer.disconnect();
			themeObserver.disconnect();
			terminal.dispose();
		};
	}, [autoFocus, terminalId]);

	return (
		<div
			className={cn(
				"h-full w-full overflow-hidden bg-surface-1 px-2 py-1.5",
				className,
			)}
			ref={containerRef}
		/>
	);
}
