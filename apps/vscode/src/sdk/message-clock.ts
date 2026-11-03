// Real wall clocks behind ClineMessage identity ids.
//
// `ClineMessage.ts` is not a time: MessageIdMinter mints it as a monotonic counter (1, 2, 3 …), so
// the newest row of a resumed session can carry `ts` 145 — which rendered in the timeline as
// "Jan 1, 1970 01:00". The real clock lives elsewhere: for restored rows in the transcript entry
// (`SdkMessage.ts`), for live rows in the instant their id was minted. This module bridges the two
// so the webview state assembly can copy it into `ClineMessage.createdAt`.
//
// Process lifetime on purpose. Every producer (live events, history rehydration) re-registers its
// ids whenever it runs, so nothing here has to survive a restart — and nothing should, because the
// counter restarts at 1 with it.

const MAX_ENTRIES = 20_000
const clocks = new Map<number, number>()

/** Remember which wall clock a freshly minted message id stands for. */
export function rememberMessageClock(ts: number, clock: number): void {
	if (!Number.isFinite(ts) || !Number.isFinite(clock)) {
		return
	}
	// Map iteration order is insertion order, so the oldest id is the first key.
	if (clocks.size >= MAX_ENTRIES && !clocks.has(ts)) {
		const oldest = clocks.keys().next()
		if (!oldest.done) {
			clocks.delete(oldest.value)
		}
	}
	clocks.set(ts, clock)
}

/** The wall clock of a message id, or undefined when this never minted or replayed it. */
export function messageClock(ts: number): number | undefined {
	return clocks.get(ts)
}
