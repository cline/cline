import type { ClineMessage } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { collectTimelineMarkers, formatShortClock, groupIntoTurns } from "../../utils/turnTimeline"
import { TimelineRail } from "./TimelineRail"

const DAY = 86_400_000
const NOW = Date.now()

const say = (ts: number, tag: string, text: string): ClineMessage => ({ ts, type: "say", say: tag as never, text })

/** Two completed turns: prompt → answer → prompt → answer. */
const LIST = [
	say(NOW - 2 * DAY, "task", "Führe den SATA-Selbsttest aus"),
	say(NOW - 2 * DAY + 5_000, "tool", "read"),
	say(NOW - 2 * DAY + 9_000, "completion_result", "Selbsttest auf allen Platten gestartet"),
	say(NOW - DAY, "user_feedback", "Und am Ende eine Zusammenfassung"),
	say(NOW - DAY + 7_000, "completion_result", "Zusammenfassung steht im Kommentar"),
]

/** Even spread: what the rail falls back to before the first measurement lands. */
function evenPositions(count: number) {
	return Array.from({ length: count }, (_, i) => (count > 1 ? i / (count - 1) : 0))
}

function renderRail(overrides: Partial<Parameters<typeof TimelineRail>[0]> = {}) {
	const markers = collectTimelineMarkers(LIST)
	const onSelect = vi.fn()
	const scrollContainer = document.createElement("div")
	const result = render(
		<TimelineRail
			markers={markers}
			onSelect={onSelect}
			positions={evenPositions(markers.length)}
			scrollContainerRef={{ current: scrollContainer }}
			sessionKey={1}
			turns={groupIntoTurns(markers)}
			{...overrides}
		/>,
	)
	return { ...result, markers, onSelect }
}

describe("TimelineRail", () => {
	it("renders nothing while there is nothing to travel between", () => {
		const markers = collectTimelineMarkers([say(NOW, "task", "nur eine Frage")])

		const { container } = render(
			<TimelineRail
				markers={markers}
				onSelect={vi.fn()}
				positions={[0]}
				scrollContainerRef={{ current: null }}
				sessionKey={1}
				turns={groupIntoTurns(markers)}
			/>,
		)

		expect(container.firstChild).toBeNull()
	})

	it("offers one labelled tick per prompt and answer", () => {
		const { markers } = renderRail()

		expect(screen.getAllByRole("button")).toHaveLength(markers.length)
		expect(screen.getAllByLabelText(/^prompt: /)).toHaveLength(2)
		expect(screen.getAllByLabelText(/^answer: /)).toHaveLength(2)
	})

	it("jumps to the marker behind a tick", () => {
		const { markers, onSelect } = renderRail()

		fireEvent.click(screen.getAllByRole("button")[1])

		expect(onSelect).toHaveBeenCalledWith(markers[1])
	})

	it("previews the summary, the wall-clock time and the distance to the reading position", () => {
		renderRail()

		// The reading position sits at the top of the rail (scrollRatio 0), this answer is a day
		// and seven seconds later — the grid rounds up, so it reads +2d.
		fireEvent.pointerEnter(screen.getAllByRole("button")[3])

		const preview = screen.getByTestId("timeline-preview")
		expect(preview.textContent).toContain("Zusammenfassung steht im Kommentar")
		expect(preview.textContent).toContain("+2d")
		expect(preview.textContent).toMatch(/\d{1,2}:\d{2}/)
	})

	it("labels the rail around the reading position, one step per label", () => {
		renderRail()

		// current = 0: the reading position carries its own time, then the markers a day and two
		// days after it. The nine-second neighbour repeats that time and is dropped.
		const labels = screen.getAllByTestId("timeline-label").map((node) => node.textContent)
		expect(labels[0]).toBe(formatShortClock(NOW - 2 * DAY))
		expect(labels[0]).toMatch(/^\d{2}:\d{2}$/)
		expect(labels.slice(1)).toEqual(["+1d", "+2d"])
	})

	it("moves the whole grid when the reading position moves", () => {
		const scrollContainer = document.createElement("div")
		// jsdom reports no geometry; give the scroller a real range and a thumb at the bottom.
		Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true })
		Object.defineProperty(scrollContainer, "clientHeight", { value: 500, configurable: true })
		Object.defineProperty(scrollContainer, "scrollTop", { value: 500, configurable: true })
		renderRail({ scrollContainerRef: { current: scrollContainer } })

		// Same markers, now measured from the last one: everything above reads as earlier, and the
		// position itself is its own time.
		const labels = screen.getAllByTestId("timeline-label").map((node) => node.textContent)
		expect(labels.slice(0, 2)).toEqual(["-2d", "-1d"])
		expect(labels[2]).toBe(formatShortClock(NOW - DAY + 7_000))
	})

	it("shows answer durations of a minute or more, rounded to minutes", () => {
		// prompt → answer after 8 minutes.
		const long = [say(NOW - 2 * DAY, "task", "frage"), say(NOW - 2 * DAY + 8 * 60_000, "completion_result", "antwort")]
		renderRail({ markers: collectTimelineMarkers(long), turns: groupIntoTurns(collectTimelineMarkers(long)) })

		fireEvent.pointerEnter(screen.getAllByRole("button")[0])

		expect(screen.getByTestId("timeline-preview").textContent).toContain("answer 8m")
	})

	it("stays quiet about an answer that came back in a few seconds", () => {
		renderRail()

		fireEvent.pointerEnter(screen.getAllByRole("button")[0])

		// The fixture's turn lasts nine seconds: below a minute, so no duration label at all.
		expect(screen.getByTestId("timeline-preview").textContent).not.toContain("answer")
	})

	/**
	 * jsdom ships no PointerEvent constructor, so fireEvent.pointerDown/Move would dispatch a bare
	 * Event without coordinates. A MouseEvent carrying the pointer type does pass clientY through,
	 * which is all the rail reads.
	 */
	function pointerEvent(element: HTMLElement, type: string, clientY: number) {
		fireEvent(element, new MouseEvent(type, { clientY, bubbles: true, cancelable: true }))
	}

	function prepareRail() {
		const rail = screen.getByTestId("timeline-rail")
		// jsdom reports a zero-sized box; give the rail a real geometry for hit-testing.
		rail.getBoundingClientRect = () => ({
			top: 0,
			left: 0,
			width: 12,
			height: 100,
			bottom: 100,
			right: 12,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		})
		// Also missing from jsdom.
		rail.setPointerCapture = vi.fn()
		rail.releasePointerCapture = vi.fn()
		rail.hasPointerCapture = () => true
		return rail
	}

	it("scrubs through the markers while dragging", () => {
		const { markers, onSelect } = renderRail()
		const rail = prepareRail()

		pointerEvent(rail, "pointerdown", 5)
		expect(onSelect).toHaveBeenLastCalledWith(markers[0])

		pointerEvent(rail, "pointermove", 95)
		expect(onSelect).toHaveBeenLastCalledWith(markers[markers.length - 1])

		pointerEvent(rail, "pointerup", 95)
		// Releasing must not fire another jump.
		expect(onSelect).toHaveBeenCalledTimes(2)
	})

	it("previews without jumping on a plain hover", () => {
		const { onSelect } = renderRail()
		const rail = prepareRail()

		pointerEvent(rail, "pointermove", 95)

		expect(onSelect).not.toHaveBeenCalled()
		expect(screen.getByTestId("timeline-preview").textContent).toContain("Zusammenfassung")
	})
})
