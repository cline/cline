"use client";

import { Kbd, KbdGroup } from "@cline/ui";
import { useEffect, useRef, useState } from "react";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";
import {
	acceleratorKeys,
	matchesAccelerator,
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

/**
 * Native Cmd+Q quits instantly, so while this is mounted with a hold time the
 * native shortcut is released (see `set_quit_shortcut_native`) and the quit
 * keybinding is handled here: the keys must stay down for `holdMs`.
 */
export function QuitHoldHandler({
	bindings,
}: {
	bindings: ResolvedKeybindings;
}) {
	const { key: accelerator, holdMs = 0 } = bindings.quit;
	const [progress, setProgress] = useState<number | null>(null);
	const holdRef = useRef<{
		start: number;
		lastEvent: number;
		repeating: boolean;
	} | null>(null);

	// A hold time of 0 (or no binding) keeps the OS's immediate Cmd+Q.
	const handlesHold = holdMs > 0 && accelerator.trim() !== "";
	useEffect(() => {
		if (!isTauriAvailable()) return;
		void desktopClient
			.invoke("set_quit_shortcut_native", { enabled: !handlesHold })
			.catch(() => {});
	}, [handlesHold]);

	useEffect(() => {
		if (!handlesHold) {
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
		const tick = () => {
			const hold = holdRef.current;
			if (!hold) return stop();
			const now = performance.now();
			const idle = now - hold.lastEvent;
			if (idle > (hold.repeating ? REPEAT_GAP_MS : FIRST_REPEAT_TIMEOUT_MS)) {
				return stop();
			}
			const elapsed = now - hold.start;
			setProgress(Math.min(1, elapsed / holdMs));
			// A bare tap never auto-repeats, so require a repeat before quitting.
			if (elapsed >= holdMs && hold.repeating) {
				stop();
				quitApp();
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (!matchesAccelerator(event, accelerator)) return;
			event.preventDefault();
			const now = performance.now();
			if (!holdRef.current) {
				holdRef.current = { start: now, lastEvent: now, repeating: false };
				setProgress(0);
				timer = window.setInterval(tick, TICK_MS);
			} else {
				holdRef.current.lastEvent = now;
				if (event.repeat) holdRef.current.repeating = true;
			}
		};
		const onRelease = (event: KeyboardEvent) => {
			// Releasing the main key or any modifier ends the hold.
			if (!holdRef.current) return;
			const released = event.key.toLowerCase();
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
	}, [accelerator, handlesHold, holdMs]);

	if (progress === null) return null;
	return (
		<div
			aria-live="polite"
			className="pointer-events-none fixed inset-x-0 bottom-10 z-[100] flex justify-center"
			role="status"
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
		</div>
	);
}
