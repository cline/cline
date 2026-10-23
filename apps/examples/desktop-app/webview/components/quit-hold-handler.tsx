"use client";

import { Kbd, KbdGroup } from "@cline/ui";
import { useEffect, useRef, useState } from "react";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";
import {
	acceleratorKeys,
	areShortcutsSuspended,
	isMacPlatform,
	matchesAccelerator,
	normalizeKeyName,
	parseAccelerator,
	type ResolvedKeybindings,
} from "@/lib/keybindings";

const TICK_MS = 40;
// macOS does not deliver keyup for a key released while Cmd is still down, so
// the hold is tracked by auto-repeat keydowns instead. Once repeating has
// started a gap this long means the key was let go.
const REPEAT_GAP_MS = 350;
// Longest wait for the first auto-repeat (the OS "delay until repeat").
const FIRST_REPEAT_TIMEOUT_MS = 1_500;

function quitApp() {
	void desktopClient.invoke("quit_app").catch(() => {});
}

/** Whether the binding is the shortcut the OS menu already handles (⌘Q). */
function isNativeQuitAccelerator(accelerator: string): boolean {
	const parsed = parseAccelerator(accelerator);
	return (
		isMacPlatform() &&
		parsed !== null &&
		parsed.mod &&
		!parsed.ctrl &&
		!parsed.alt &&
		!parsed.shift &&
		parsed.key === "q"
	);
}

/**
 * Handles the quit keybinding while the webview has focus. Native ⌘Q is
 * restored on blur so hidden or minimized windows can still quit immediately.
 * While focused, only an immediate ⌘Q binding uses the native accelerator;
 * all other bindings release it and are handled here instead.
 */
export function QuitHoldHandler({
	bindings,
}: {
	bindings: ResolvedKeybindings;
}) {
	const { key: accelerator, holdMs = 0 } = bindings.quit;
	const [progress, setProgress] = useState<number | null>(null);
	const holdRef = useRef<{ start: number; lastRepeat: number | null } | null>(
		null,
	);

	const bound = accelerator.trim() !== "";
	const nativeQuit =
		bound && holdMs === 0 && isNativeQuitAccelerator(accelerator);
	useEffect(() => {
		if (!isTauriAvailable()) return;
		const setNativeQuit = (enabled: boolean) => {
			void desktopClient
				.invoke("set_quit_shortcut_native", { enabled })
				.catch(() => {});
		};
		const onFocus = () => setNativeQuit(nativeQuit);
		const onBlur = () => setNativeQuit(true);
		window.addEventListener("focus", onFocus);
		window.addEventListener("blur", onBlur);
		setNativeQuit(nativeQuit || !document.hasFocus());
		return () => {
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("blur", onBlur);
			setNativeQuit(true);
		};
	}, [nativeQuit]);

	useEffect(() => {
		if (!bound || nativeQuit) {
			holdRef.current = null;
			setProgress(null);
			return;
		}
		let timer: number | undefined;
		const stop = () => {
			holdRef.current = null;
			setProgress(null);
			if (timer !== undefined) {
				window.clearInterval(timer);
				timer = undefined;
			}
		};
		// Only drives the progress bar and the release timeout; quitting itself
		// happens on a keydown so time after the key was let go never counts.
		const tick = () => {
			const hold = holdRef.current;
			if (!hold) return stop();
			const now = performance.now();
			const idle = now - (hold.lastRepeat ?? hold.start);
			if (idle > (hold.lastRepeat ? REPEAT_GAP_MS : FIRST_REPEAT_TIMEOUT_MS)) {
				return stop();
			}
			setProgress(Math.min(1, (now - hold.start) / holdMs));
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (areShortcutsSuspended()) return stop();
			if (!matchesAccelerator(event, accelerator)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (holdMs === 0) {
				if (!event.repeat) quitApp();
				return;
			}
			const now = performance.now();
			const hold = holdRef.current;
			if (!hold || !event.repeat) {
				// A fresh press starts over even if macOS omitted the previous keyup.
				stop();
				holdRef.current = { start: now, lastRepeat: null };
				setProgress(0);
				timer = window.setInterval(tick, TICK_MS);
				return;
			}
			// A bare tap never auto-repeats, so the quit needs a repeat event that
			// arrives at or after the threshold: proof the key is still down.
			hold.lastRepeat = now;
			if (now - hold.start >= holdMs) {
				stop();
				quitApp();
			}
		};
		const onRelease = (event: KeyboardEvent) => {
			// Releasing the main key or any modifier ends the hold.
			if (!holdRef.current) return;
			const released = normalizeKeyName(event.key);
			const main = parseAccelerator(accelerator)?.key;
			if (
				["meta", "control", "alt", "shift"].includes(released) ||
				released === main
			) {
				stop();
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("keyup", onRelease, true);
		window.addEventListener("blur", stop);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("keyup", onRelease, true);
			window.removeEventListener("blur", stop);
			stop();
		};
	}, [accelerator, bound, holdMs, nativeQuit]);

	if (progress === null) return null;
	return (
		<output
			aria-live="polite"
			className="pointer-events-none fixed inset-x-0 bottom-10 z-[100] flex justify-center"
		>
			<div className="w-64 rounded-lg border bg-popover px-4 py-3 text-popover-foreground shadow-lg">
				<p className="flex items-center gap-2 text-sm font-medium">
					Hold
					<KbdGroup>
						{acceleratorKeys(accelerator).map((part) => (
							<Kbd key={part}>{part}</Kbd>
						))}
					</KbdGroup>
					to quit
				</p>
				<div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
					<div
						className="h-full bg-primary"
						style={{ width: `${Math.round(progress * 100)}%` }}
					/>
				</div>
			</div>
		</output>
	);
}
