import { type RefObject, useEffect, useState } from "react"

/**
 * Whether an element is at least partly inside the chat list's viewport.
 *
 * Folding needs this: taking content away from a reader who can see it is a different act from
 * tidying up something they have scrolled past, and the difference is a viewport question, not a
 * data question. Reported through an `IntersectionObserver`, because the list scrolls without the
 * component re-rendering.
 *
 * The observer only reports changes, so the first answer is measured from the rects — otherwise a
 * fold that mounts off-screen would start out “visible” and reveal its rows before the first
 * callback corrected it.
 */
export function useElementInView(ref: RefObject<HTMLElement | null>): boolean {
	const [inView, setInView] = useState(true)

	useEffect(() => {
		const element = ref.current
		if (!element) {
			return
		}
		const container = element.closest<HTMLElement>(".chat-scrollbar")
		const visible = () => {
			if (!container) {
				return true
			}
			const box = element.getBoundingClientRect()
			const viewport = container.getBoundingClientRect()
			return box.bottom > viewport.top + 1 && box.top < viewport.bottom - 1
		}
		setInView(visible())
		if (typeof IntersectionObserver === "undefined" || !container) {
			return
		}
		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[entries.length - 1]
				if (entry) {
					setInView(entry.isIntersecting)
				}
			},
			{ root: container, threshold: 0 },
		)
		observer.observe(element)
		return () => observer.disconnect()
	}, [ref])

	return inView
}
