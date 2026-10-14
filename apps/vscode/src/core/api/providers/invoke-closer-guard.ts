import { NonRetriableStreamError } from "../retry"

const CLOSER = "</invoke>"

/** Consecutive closers that no legitimate output produces (a real tool call has one). */
export const MAX_CONSECUTIVE_INVOKE_CLOSERS = 20

/**
 * Containment for models that degenerate into `</invoke></invoke>...` plain-text loops.
 * Counts consecutive `</invoke>` closers (whitespace between them ignored) across arbitrary
 * delta boundaries. State is O(1): a run counter plus < 9 chars of a possibly split tag.
 * Any other text resets the run, so quoted examples and single closers never trip it.
 */
export class InvokeCloserGuard {
	private run = 0
	private pending = ""

	reset(): void {
		this.run = 0
		this.pending = ""
	}

	/** Feed a plain-text delta. Throws NonRetriableStreamError when the run reaches the threshold. */
	push(text: string): void {
		const buf = this.pending + text
		this.pending = ""
		let i = 0
		while (i < buf.length) {
			if (buf.startsWith(CLOSER, i)) {
				this.run++
				i += CLOSER.length
				if (this.run >= MAX_CONSECUTIVE_INVOKE_CLOSERS) {
					throw new NonRetriableStreamError(
						`Model output degenerated into ${this.run} consecutive "</invoke>" closers; the response was stopped. ` +
							`No tool was executed. This is not retried automatically.`,
					)
				}
			} else if (this.run > 0 && /\s/.test(buf[i])) {
				i++
			} else if (CLOSER.startsWith(buf.slice(i))) {
				// split tag at end of delta: carry over
				this.pending = buf.slice(i)
				return
			} else {
				this.run = 0
				const next = buf.indexOf("<", i + 1)
				if (next === -1) {
					return
				}
				i = next
			}
		}
	}
}
