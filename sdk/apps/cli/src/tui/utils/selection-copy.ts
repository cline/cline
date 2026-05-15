import type { Selection } from "@opentui/core";
import { copyTextToSystemClipboard } from "./clipboard";

export type ToastKind = "success" | "error";

export interface SelectionCopyDeps {
	copyToClipboardOSC52: (text: string) => boolean;
	showToast: (message: string, kind: ToastKind) => void;
	copyTextToSystemClipboardImpl?: typeof copyTextToSystemClipboard;
}

export interface SelectionCopyHandle {
	handleSelection: (selection: Selection) => void;
	dispose: () => void;
}

export function createSelectionCopyHandler(
	deps: SelectionCopyDeps,
): SelectionCopyHandle {
	const copyImpl =
		deps.copyTextToSystemClipboardImpl ?? copyTextToSystemClipboard;
	let mounted = true;
	let inFlight: AbortController | undefined;
	let generation = 0;

	const handleSelection = (selection: Selection) => {
		const text = selection.getSelectedText();
		if (!text) {
			return;
		}

		inFlight?.abort();
		inFlight = undefined;

		const ticket = ++generation;

		// Some terminals accept the OSC 52 write but do not update the system
		// clipboard. Keep OSC 52 for SSH and capable terminals, then also try the
		// native clipboard path so local Terminal.app gets pbcopy.
		const copiedWithOsc52 = deps.copyToClipboardOSC52(text);

		const controller = new AbortController();
		inFlight = controller;

		const finish = (copiedWithSystemClipboard: boolean) => {
			if (!mounted || ticket !== generation) {
				return;
			}
			if (inFlight === controller) {
				inFlight = undefined;
			}
			if (controller.signal.aborted) {
				return;
			}
			const copied = copiedWithSystemClipboard || copiedWithOsc52;
			deps.showToast(
				copied ? "Copied to clipboard" : "Unable to copy selection",
				copied ? "success" : "error",
			);
		};

		void copyImpl(text, { signal: controller.signal })
			.then(finish)
			.catch(() => finish(false));
	};

	const dispose = () => {
		mounted = false;
		inFlight?.abort();
		inFlight = undefined;
	};

	return { handleSelection, dispose };
}
