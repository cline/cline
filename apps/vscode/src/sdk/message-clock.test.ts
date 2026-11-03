import type { MessageWithMetadata as SdkMessage } from "@cline/llms"
import { describe, expect, it } from "vitest"
import { messageClock, rememberMessageClock } from "./message-clock"
import { MessageIdMinter } from "./message-id-minter"
import { MessageTranslatorState, sdkMessagesToClineMessages } from "./message-translator"

// A transcript from 2023-11-14. The point of these tests is that restored rows keep *that* date
// instead of being dated to the moment the session was opened.
const TRANSCRIPT_TS = 1_700_000_000_000

describe("message-clock", () => {
	it("remembers the wall clock of a minted id", () => {
		rememberMessageClock(4101, TRANSCRIPT_TS)
		expect(messageClock(4101)).toBe(TRANSCRIPT_TS)
	})

	it("lets a later clock win, and ignores values that are not clocks", () => {
		rememberMessageClock(4102, TRANSCRIPT_TS)
		rememberMessageClock(4102, TRANSCRIPT_TS - 1000)
		expect(messageClock(4102)).toBe(TRANSCRIPT_TS - 1000)
		rememberMessageClock(Number.NaN, TRANSCRIPT_TS)
		expect(messageClock(Number.NaN)).toBeUndefined()
	})

	it("knows nothing about an id it never minted", () => {
		expect(messageClock(9_876_543)).toBeUndefined()
	})
})

describe("message clocks behind ClineMessage ids", () => {
	it("dates live ids by the wall clock", () => {
		const state = new MessageTranslatorState(new MessageIdMinter(7000))
		const before = Date.now()
		const ts = state.nextTs()
		const clock = messageClock(ts)
		expect(clock).toBeGreaterThanOrEqual(before)
		expect(clock).toBeLessThanOrEqual(Date.now())
	})

	it("dates restored rows by the transcript, not by now", () => {
		const before = Date.now()
		const messages = sdkMessagesToClineMessages(
			[
				{
					id: "u1",
					role: "user",
					ts: TRANSCRIPT_TS,
					content: [{ type: "text", text: "frage von damals" }],
				} as SdkMessage,
				{
					id: "a1",
					role: "assistant",
					ts: TRANSCRIPT_TS + 60_000,
					content: [{ type: "text", text: "antwort von damals" }],
				} as SdkMessage,
			],
			new MessageIdMinter(9000),
		)
		const clocks = messages.map((message) => messageClock(message.ts)).filter((clock): clock is number => clock !== undefined)

		expect(clocks.length).toBeGreaterThan(0)
		// Without the transcript clock every row would carry `Date.now()` and the timeline would
		// read "now, now, now" across a session that happened months apart.
		expect(Math.max(...clocks)).toBeLessThan(before)
		expect(clocks).toContain(TRANSCRIPT_TS)
	})
})
