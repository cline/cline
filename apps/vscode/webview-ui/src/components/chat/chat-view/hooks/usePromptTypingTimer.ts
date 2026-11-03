import type { ClineMessage } from "@shared/ExtensionMessage"
import { useEffect, useRef } from "react"
import { recordPromptTypingMs } from "../utils/promptTimings"

/** Anything longer was almost certainly an abandoned draft, not a typing session. */
const MAX_TRACKED_TYPING_MS = 2 * 60 * 60 * 1000

function isUserAuthored(message: ClineMessage): boolean {
	return message.type === "say" && (message.say === "task" || message.say === "user_feedback")
}

/**
 * Measures how long the user typed each prompt: first real character until the row is sent.
 *
 * The start is taken from the input, the end from `clineMessages` — the backend replica, not the
 * rendered list. That distinction matters: the webview shows an optimistic `user_feedback` row
 * immediately and swaps it for the backend row once confirmed (`pendingResponse.ts` hides it on
 * match), and the two carry different `ts` values. Keying off the replica records the timestamp
 * that is actually still there after a reload.
 *
 * The start timestamp deliberately survives the input being cleared: the send clears it a moment
 * before the row arrives, and "first real character until send" also covers a prompt that was
 * edited, emptied and retyped before being submitted.
 *
 * Mount this above the message list: `MessagesArea` only renders once a task exists, so a timer
 * living there would miss the very first prompt of a session. Rows older than the pending start
 * are ignored, which is also what keeps a task switch from attributing an old prompt to new typing.
 */
export function usePromptTypingTimer(options: {
	sessionKey: number | undefined
	inputValue: string
	clineMessages: ClineMessage[]
}): void {
	const { sessionKey, inputValue, clineMessages } = options
	const firstKeystrokeRef = useRef<number | undefined>(undefined)
	const seenRef = useRef<Set<number>>(new Set())

	// Arm the stopwatch on the first non-whitespace character.
	useEffect(() => {
		if (firstKeystrokeRef.current === undefined && inputValue.trim().length > 0) {
			firstKeystrokeRef.current = Date.now()
		}
	}, [inputValue])

	useEffect(() => {
		const started = firstKeystrokeRef.current
		if (started === undefined) {
			// Nothing typed in this webview session (restored task, or sent from elsewhere):
			// adopt the rows that already exist so they are not mistaken for a fresh submit.
			for (const message of clineMessages) {
				if (isUserAuthored(message)) {
					seenRef.current.add(message.ts)
				}
			}
			return
		}
		if (sessionKey === undefined) {
			return
		}

		for (const message of clineMessages) {
			if (!isUserAuthored(message) || message.ts < started || seenRef.current.has(message.ts)) {
				continue
			}
			seenRef.current.add(message.ts)
			const typingMs = message.ts - started
			if (typingMs > 0 && typingMs <= MAX_TRACKED_TYPING_MS) {
				recordPromptTypingMs(sessionKey, message.ts, typingMs)
			}
			// One measurement per keystroke session: the next prompt needs fresh typing.
			firstKeystrokeRef.current = undefined
			return
		}
	}, [clineMessages, sessionKey])
}
