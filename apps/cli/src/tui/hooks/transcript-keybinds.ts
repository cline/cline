export type TranscriptCommand =
	| "messages_page_up"
	| "messages_page_down"
	| "messages_half_page_up"
	| "messages_half_page_down"
	| "messages_first"
	| "messages_last";

type TranscriptKey = {
	name: string;
	ctrl: boolean;
	meta: boolean;
	shift: boolean;
};

type TranscriptKeybind = {
	name: string;
	ctrl?: boolean;
	meta?: boolean;
	shift?: boolean;
};

export const TRANSCRIPT_KEYBINDS: Record<
	TranscriptCommand,
	readonly TranscriptKeybind[]
> = {
	messages_page_up: [{ name: "pageup" }, { name: "b", ctrl: true, meta: true }],
	messages_page_down: [
		{ name: "pagedown" },
		{ name: "f", ctrl: true, meta: true },
	],
	messages_half_page_up: [{ name: "u", ctrl: true, meta: true }],
	messages_half_page_down: [{ name: "d", ctrl: true, meta: true }],
	messages_first: [{ name: "g", ctrl: true }],
	messages_last: [{ name: "g", ctrl: true, meta: true }],
};

function keybindMatches(
	keybind: TranscriptKeybind,
	key: TranscriptKey,
): boolean {
	return (
		key.name === keybind.name &&
		key.ctrl === !!keybind.ctrl &&
		key.meta === !!keybind.meta &&
		key.shift === !!keybind.shift
	);
}

export function matchTranscriptKeybind(
	key: TranscriptKey,
): TranscriptCommand | null {
	for (const [command, keybinds] of Object.entries(TRANSCRIPT_KEYBINDS)) {
		if (keybinds.some((keybind) => keybindMatches(keybind, key))) {
			return command as TranscriptCommand;
		}
	}
	return null;
}
